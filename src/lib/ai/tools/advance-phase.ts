import { ls } from '$lib/localization';
import type { ToolSet } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import { recordActPhaseTransition } from '$lib/db/act-lines';
import { ACT_PHASE_ORDER, type ActPhase } from '$lib/ai/narrative-types';
import { getNextActPhase } from '$lib/ai/narrative-types';
import { getLocalizedActPhase } from '$lib/definitions/pipeline-prompts';
import { actWithNumberLabel } from '$lib/definitions/common-labels';
import type { AssistantContext } from '$lib/ai/pipeline/types';
import { log } from './utils';

const GOAL_COMPLETION_THRESHOLD = 5;

function formatActPhaseDescription(actPhase: ActPhase): string {
	return `\`${actPhase}\`: ${getLocalizedActPhase(actPhase)}`;
}

export function createAdvancePhaseTool(actLineId: string, currentPhase: ActPhase | null, actNumber: number, assistant: AssistantContext) {
	let hasAdvancedPhase = false;
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
			justification: z
				.string()
				.describe(ls('tools.advancePhase.parameters.justification', { actWithNumber: actWithNumberLabel(actNumber) })),
			goalCompletionScore: z.number().min(0).max(10).describe(ls('tools.advancePhase.parameters.goalCompletionScore')),
		}),
		execute: async ({
			currentPhase: inputCurrentPhase,
			nextPhase: inputNextPhase,
			justification,
			goalCompletionScore,
		}): Promise<{ result: string }> => {
			if (hasAdvancedPhase) {
				await log('advance-phase triggered: already advanced');
				return { result: ls('tools.advancePhase.messages.alreadyAdvanced') };
			}

			await log(`advance-phase justification (score ${goalCompletionScore}): ${justification}`);

			if (goalCompletionScore < GOAL_COMPLETION_THRESHOLD) {
				await log(`advance-phase rejected: goalCompletionScore ${goalCompletionScore} below threshold ${GOAL_COMPLETION_THRESHOLD}`);
				return { result: ls('tools.advancePhase.messages.goalCompletionTooLow', { score: goalCompletionScore }) };
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

export function allowAdvancePhaseTools(plotMode: string, actPhase: ActPhase | null): boolean {
	return plotMode === 'phaseEvent' && actPhase !== 'resolution';
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
