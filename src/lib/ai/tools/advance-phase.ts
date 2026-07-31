import { ls } from '$lib/localization';
import type { ToolSet } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import { recordActPhaseTransition } from '$lib/db/act-lines';
import { ACT_PHASE_ORDER, type ActPhase } from '$lib/ai/narrative-types';
import { getNextActPhase } from '$lib/ai/narrative-types';
import { getLocalizedActPhase } from '$lib/definitions/pipeline-prompts';
import { actWithNumberLabel } from '$lib/definitions/common-labels';
import { settings } from '$lib/stores/settings.svelte';
import type { ActLineContext, AssistantContext } from '$lib/ai/pipeline/types';
import { log } from './utils';

const EARLY_PHASE_FACTOR = 0.3;
const LATE_PHASE_FACTOR = 1 - EARLY_PHASE_FACTOR;

// Types & Schemas

type PhaseStage = 'early' | 'mid' | 'late';

function formatActPhaseDescription(actPhase: ActPhase): string {
	return `\`${actPhase}\`: ${getLocalizedActPhase(actPhase)}`;
}

/**
 * Base schema for phase transition tools. Built as a factory (not a module constant)
 * because `ls()` resolves against a locale cache populated at runtime by
 * `loadLocaleStrings()`, so it must be called at build time, not import time.
 */
function getBaseSchema() {
	return z.object({
		currentPhase: z.enum(ACT_PHASE_ORDER).describe(ls('tools.advancePhase.parameters.currentPhase')),
		nextPhase: z.enum(ACT_PHASE_ORDER).describe(ls('tools.advancePhase.parameters.nextPhase')),
	});
}

/**
 * Schema factory for narrative gating evaluation metrics.
 */
function getGatingSchema(actNumber: number) {
	return z.object({
		justification: z.string().describe(ls('tools.advancePhase.parameters.justification', { actWithNumber: actWithNumberLabel(actNumber) })),
		numberOfPhaseEventsElaborated: z.number().int().min(0).describe(ls('tools.advancePhase.parameters.numberOfPhaseEventsElaborated')),
		narrativeCompletionScore: z.number().min(0).max(10).describe(ls('tools.advancePhase.parameters.narrativeCompletionScore')),
		playerDivergenceScore: z.number().min(0).max(10).describe(ls('tools.advancePhase.parameters.playerDivergenceScore')),
	});
}

// Derived automatically from Zod to ensure single source of truth
type GatingMetrics = z.infer<ReturnType<typeof getGatingSchema>>;

/**
 * Creates the dynamic schema depending on whether gating evaluation metrics are enabled.
 * When gating is active, the tool schema requires the LLM to supply reasoning and score metrics.
 */
function getAdvancePhaseSchema(gatingSchema: ReturnType<typeof getGatingSchema>, gatingEnabled: boolean) {
	if (!gatingEnabled) return getBaseSchema();
	return getBaseSchema().extend(gatingSchema.shape);
}

/**
 * Calculates scene progress relative to the start of the current act phase boundary.
 */
function resolveSceneProgress(actLine: ActLineContext, currentScene: number): number {
	const { actPhaseBoundaries, currentActPhase } = actLine;
	const phaseBoundary = actPhaseBoundaries.find((p) => p.phase === currentActPhase);

	if (phaseBoundary?.sceneNumber !== undefined && phaseBoundary.sceneNumber <= currentScene) {
		return currentScene - phaseBoundary.sceneNumber;
	}

	return currentScene;
}

/**
 * Calculates scene count thresholds based on estimated phase lengths and scaling factors.
 */
function calculatePhaseThreshold(phaseLengthEstimate: number | null, factor: number, minThreshold: number): number {
	if (phaseLengthEstimate != null && phaseLengthEstimate > 2) {
		const threshold = Math.floor(phaseLengthEstimate * factor);
		return Math.max(minThreshold, threshold);
	}

	return minThreshold;
}

/**
 * Categorizes the current phase progress into early, mid, or late stages based on scene counts.
 * Stage boundaries determine the strictness of gating thresholds required to advance.
 */
function resolvePhaseStage(actLine: ActLineContext, currentScene: number): PhaseStage {
	const progress = resolveSceneProgress(actLine, currentScene);
	const earlyThreshold = calculatePhaseThreshold(actLine.currentActPhaseLengthEstimate, EARLY_PHASE_FACTOR, 1);
	const lateThreshold = calculatePhaseThreshold(actLine.currentActPhaseLengthEstimate, LATE_PHASE_FACTOR, 2);

	if (progress >= lateThreshold) return 'late';
	if (progress >= earlyThreshold) return 'mid';
	return 'early';
}

/**
 * Evaluates whether narrative progress meets criteria to advance to the next phase.
 *
 * Gating Logic Workflow:
 * - 'late' stage: Automatically allowed to advance (phase length reached).
 * - 'early' stage: Requires >= 1 elaborated event AND both narrative & divergence scores to meet thresholds.
 * - 'mid' stage: Requires >= 1 elaborated event AND at least one score to meet threshold.
 */
async function passesGating(
	metrics: GatingMetrics,
	actLine: ActLineContext,
	milestoneThreshold: number,
	divergenceThreshold: number
): Promise<boolean> {
	const { justification, numberOfPhaseEventsElaborated, narrativeCompletionScore, playerDivergenceScore } = metrics;

	const currentScene = actLine.currentScene ?? 1;
	const stage = resolvePhaseStage(actLine, currentScene);
	const sceneProgress = resolveSceneProgress(actLine, currentScene);

	let shouldAdvance: boolean;
	if (stage === 'late') {
		shouldAdvance = true;
	} else if (stage === 'early') {
		shouldAdvance =
			numberOfPhaseEventsElaborated >= 1 && narrativeCompletionScore >= milestoneThreshold && playerDivergenceScore >= divergenceThreshold;
	} else {
		shouldAdvance =
			numberOfPhaseEventsElaborated >= 1 &&
			(narrativeCompletionScore >= milestoneThreshold || playerDivergenceScore >= divergenceThreshold);
	}

	await log(
		`advance-phase assessment (justification: ${justification}) | ` +
			`eventsElaborated=${numberOfPhaseEventsElaborated} ` +
			`narrativeScore=${narrativeCompletionScore}/${milestoneThreshold} ` +
			`divergenceScore=${playerDivergenceScore}/${divergenceThreshold} ` +
			`stage=${stage} sceneProgress=${sceneProgress} → ${shouldAdvance ? 'ADVANCE' : 'BLOCKED'}`
	);

	return shouldAdvance;
}

/**
 * Factory function creating the `advance-phase` tool bound to a specific ActLine context.
 */
export function createAdvancePhaseTool(actLine: ActLineContext, assistant: AssistantContext) {
	let hasAdvancedPhase = false;
	const actLineId = actLine.id;
	const currentPhase = actLine.currentActPhase;
	const actNumber = actLine.actNumber;
	const milestoneThreshold = settings.phaseAdvancementThreshold;
	const divergenceThreshold = settings.playerDivergenceThreshold;
	const gatingEnabled = milestoneThreshold > 0;

	const gatingSchema = getGatingSchema(actNumber);
	const inputSchema = getAdvancePhaseSchema(gatingSchema, gatingEnabled);

	return tool({
		description: ls('tools.advancePhase.description', {
			introduction: formatActPhaseDescription('introduction'),
			risingAction: formatActPhaseDescription('rising-action'),
			climax: formatActPhaseDescription('climax'),
			fallingAction: formatActPhaseDescription('falling-action'),
			resolution: formatActPhaseDescription('resolution'),
		}),
		inputSchema,
		execute: async (input): Promise<{ result: string }> => {
			// Guard 1: Prevent duplicate phase transitions within a single turn execution
			if (hasAdvancedPhase) {
				await log('advance-phase triggered: already advanced');
				return { result: ls('tools.advancePhase.messages.alreadyAdvanced') };
			}

			const effectiveCurrentPhase = currentPhase ?? input.currentPhase;

			// Guard 2: Terminal phase check
			const nextPhase = getNextActPhase(effectiveCurrentPhase);
			if (!nextPhase) {
				await log('advance-phase triggered: terminal phase');
				return { result: ls('tools.advancePhase.messages.terminalPhase') };
			}

			// Guard 3: Validate LLM parameters against system state
			if (input.currentPhase !== effectiveCurrentPhase) {
				await log(`advance-phase mismatch: current (LLM: ${input.currentPhase}, actual: ${effectiveCurrentPhase})`);
				return {
					result: ls('tools.advancePhase.messages.phaseMismatch.current', {
						actual: formatActPhaseDescription(effectiveCurrentPhase),
						provided: formatActPhaseDescription(input.currentPhase),
					}),
				};
			}

			if (input.nextPhase !== nextPhase) {
				await log(`advance-phase mismatch: next (LLM: ${input.nextPhase}, expected: ${nextPhase})`);
				return {
					result: ls('tools.advancePhase.messages.phaseMismatch.next', {
						actual: formatActPhaseDescription(effectiveCurrentPhase),
						expected: formatActPhaseDescription(nextPhase),
						provided: formatActPhaseDescription(input.nextPhase),
					}),
				};
			}

			// Guard 4: Evaluate narrative gating thresholds type-safely without unsafe casting
			if (gatingEnabled) {
				const gatingMetrics = gatingSchema.parse(input);
				const shouldAdvance = await passesGating(gatingMetrics, actLine, milestoneThreshold, divergenceThreshold);
				if (!shouldAdvance) {
					return { result: ls('tools.advancePhase.messages.advancementBlocked') };
				}
			}

			// Transition state commit
			await recordActPhaseTransition(actLineId, assistant, nextPhase);
			await log(`advance-phase triggered: advancing to ${nextPhase}`);
			hasAdvancedPhase = true;

			return {
				result: ls('tools.advancePhase.messages.success', {
					current: formatActPhaseDescription(effectiveCurrentPhase),
					next: formatActPhaseDescription(nextPhase),
				}),
			};
		},
	});
}

/**
 * Determines whether the advance phase tool should be provided to the LLM for the current turn.
 * Enabled only in 'phaseEvent' plot mode, before 'resolution', and after passing ~50% scene threshold.
 */
export function allowAdvancePhaseTools(
	plotMode: string,
	actPhase: ActPhase | null,
	sceneCount: number | null,
	lengthEstimate: number | null
): boolean {
	if (plotMode !== 'phaseEvent' || actPhase === 'resolution') return false;
	if (sceneCount === null) return true;

	const threshold = calculatePhaseThreshold(lengthEstimate, 0.5, 2);
	return sceneCount >= threshold;
}

export function buildAdvancePhaseTools(actLine: ActLineContext, assistant: AssistantContext): ToolSet {
	return {
		'advance-phase': createAdvancePhaseTool(actLine, assistant),
	};
}
