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
import type { AssistantContext } from '$lib/ai/pipeline/types';
import { log } from './utils';

function formatActPhaseDescription(actPhase: ActPhase): string {
	return `\`${actPhase}\`: ${getLocalizedActPhase(actPhase)}`;
}

export function createAdvancePhaseTool(actLineId: string, currentPhase: ActPhase | null, actNumber: number, assistant: AssistantContext) {
	let hasAdvancedPhase = false;
	const milestoneThreshold = settings.phaseAdvancementThreshold;
	const divergenceThreshold = settings.playerDivergenceThreshold;
	const gatingEnabled = milestoneThreshold > 0;
	return tool({
		description: ls('tools.advancePhase.description', {
			introduction: formatActPhaseDescription('introduction'),
			risingAction: formatActPhaseDescription('rising-action'),
			climax: formatActPhaseDescription('climax'),
			fallingAction: formatActPhaseDescription('falling-action'),
			resolution: formatActPhaseDescription('resolution'),
		}),
		inputSchema: z.object({
			currentPhase: z.enum(ACT_PHASE_ORDER).describe(ls('tools.advancePhase.parameters.currentPhase')),
			nextPhase: z.enum(ACT_PHASE_ORDER).describe(ls('tools.advancePhase.parameters.nextPhase')),
			...(gatingEnabled
				? {
						justification: z
							.string()
							.describe(ls('tools.advancePhase.parameters.justification', { actWithNumber: actWithNumberLabel(actNumber) })),
						numberOfPhaseEventsElaborated: z
							.number()
							.int()
							.min(0)
							.describe(ls('tools.advancePhase.parameters.numberOfPhaseEventsElaborated')),
						furtherElaborationWouldCauseDrag: z.boolean().describe(ls('tools.advancePhase.parameters.furtherElaborationWouldCauseDrag')),
						narrativeCompletionScore: z.number().min(0).max(10).describe(ls('tools.advancePhase.parameters.narrativeCompletionScore')),
						playerDivergenceScore: z.number().min(0).max(10).describe(ls('tools.advancePhase.parameters.playerDivergenceScore')),
					}
				: {}),
		}),
		execute: async ({ currentPhase: inputCurrentPhase, nextPhase: inputNextPhase, ...rest }): Promise<{ result: string }> => {
			if (hasAdvancedPhase) {
				await log('advance-phase triggered: already advanced');
				return { result: ls('tools.advancePhase.messages.alreadyAdvanced') };
			}

			if (gatingEnabled) {
				const justification = rest.justification as string;
				const numberOfPhaseEventsElaborated = rest.numberOfPhaseEventsElaborated as number;
				const furtherElaborationWouldCauseDrag = rest.furtherElaborationWouldCauseDrag as boolean;
				const narrativeCompletionScore = rest.narrativeCompletionScore as number;
				const playerDivergenceScore = rest.playerDivergenceScore as number;

				const milestoneMet =
					numberOfPhaseEventsElaborated >= 1 && furtherElaborationWouldCauseDrag && narrativeCompletionScore >= milestoneThreshold;
				const playerDivergenceMet = playerDivergenceScore >= divergenceThreshold;
				const shouldAdvance = milestoneMet || playerDivergenceMet;

				await log(
					`advance-phase assessment (justification: ${justification}) | ` +
						`eventsElaborated=${numberOfPhaseEventsElaborated} drag=${furtherElaborationWouldCauseDrag} ` +
						`narrativeScore=${narrativeCompletionScore}/${milestoneThreshold} ` +
						`divergenceScore=${playerDivergenceScore}/${divergenceThreshold} ` +
						`milestoneMet=${milestoneMet} playerDivergenceMet=${playerDivergenceMet} → ${shouldAdvance ? 'ADVANCE' : 'BLOCKED'}`
				);

				if (!shouldAdvance) {
					return {
						result: ls('tools.advancePhase.messages.advancementBlocked'),
					};
				}
			}

			const effectiveCurrentPhase = currentPhase ?? inputCurrentPhase;

			const nextPhase = getNextActPhase(effectiveCurrentPhase);
			if (!nextPhase) {
				await log('advance-phase triggered: already terminal phase');
				return { result: ls('tools.advancePhase.messages.terminalPhase') };
			}

			if (inputCurrentPhase !== effectiveCurrentPhase) {
				await log(`advance-phase: currentPhase mismatch (LLM: ${inputCurrentPhase}, actual: ${effectiveCurrentPhase})`);
				return {
					result: ls('tools.advancePhase.messages.phaseMismatch.current', {
						actual: formatActPhaseDescription(effectiveCurrentPhase),
						provided: formatActPhaseDescription(inputCurrentPhase),
					}),
				};
			}

			if (inputNextPhase !== nextPhase) {
				await log(`advance-phase: nextPhase mismatch (LLM: ${inputNextPhase}, expected: ${nextPhase})`);
				return {
					result: ls('tools.advancePhase.messages.phaseMismatch.next', {
						actual: formatActPhaseDescription(effectiveCurrentPhase),
						expected: formatActPhaseDescription(nextPhase),
						provided: formatActPhaseDescription(inputNextPhase),
					}),
				};
			}

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

export function allowAdvancePhaseTools(
	plotMode: string,
	actPhase: ActPhase | null,
	sceneCount: number | null,
	lengthEstimate: number | null
): boolean {
	if (plotMode !== 'phaseEvent' || actPhase === 'resolution') return false;
	if (sceneCount === null) return true;
	const effectiveEstimate = lengthEstimate == null || lengthEstimate < 2 ? 2 : lengthEstimate;
	const threshold = Math.max(2, Math.floor(effectiveEstimate / 2));
	return sceneCount >= threshold;
}

export function buildAdvancePhaseTools(
	actLineId: string,
	currentPhase: ActPhase | null,
	actNumber: number,
	assistant: AssistantContext
): ToolSet {
	return {
		'advance-phase': createAdvancePhaseTool(actLineId, currentPhase, actNumber, assistant),
	};
}
