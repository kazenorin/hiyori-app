import { ls } from '$lib/localization';
import type { ToolSet } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import { recordActPhaseTransition } from '$lib/db/act-lines';
import { ACT_PHASE_ORDER, type ActPhase } from '$lib/ai/narrative-types';
import { getNextActPhase } from '$lib/ai/narrative-types';
import { getLocalizedActPhase } from '$lib/definitions/pipeline-prompts';
import type { AssistantContext } from '$lib/ai/pipeline/types';
import { log } from './utils';

export function createAdvancePhaseTool(actLineId: string, currentPhase: ActPhase | null, assistant: AssistantContext) {
	let hasAdvancedPhase = false;
	return tool({
		description: ls('tools.advancePhase.description', {
			introduction: getLocalizedActPhase('introduction'),
			risingAction: getLocalizedActPhase('rising-action'),
			climax: getLocalizedActPhase('climax'),
			fallingAction: getLocalizedActPhase('falling-action'),
			resolution: getLocalizedActPhase('resolution'),
		}),
		inputSchema: z.object({
			currentPhase: z.enum(ACT_PHASE_ORDER).describe(ls('tools.advancePhase.parameters.currentPhase')),
			nextPhase: z.enum(ACT_PHASE_ORDER).describe(ls('tools.advancePhase.parameters.nextPhase')),
		}),
		execute: async ({ currentPhase: inputCurrentPhase, nextPhase: inputNextPhase }): Promise<{ result: string }> => {
			if (hasAdvancedPhase) {
				await log('advance-phase triggered: already advanced');
				return { result: ls('tools.advancePhase.messages.alreadyAdvanced') };
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
						actual: getLocalizedActPhase(effectiveCurrentPhase),
						provided: getLocalizedActPhase(inputCurrentPhase),
					}),
				};
			}

			if (inputNextPhase !== nextPhase) {
				await log(`advance-phase: nextPhase mismatch (LLM: ${inputNextPhase}, expected: ${nextPhase})`);
				return {
					result: ls('tools.advancePhase.messages.phaseMismatch.next', {
						actual: getLocalizedActPhase(effectiveCurrentPhase),
						expected: getLocalizedActPhase(nextPhase),
						provided: getLocalizedActPhase(inputNextPhase),
					}),
				};
			}

			await recordActPhaseTransition(actLineId, assistant, nextPhase);
			await log(`advance-phase triggered: advancing to ${nextPhase}`);
			hasAdvancedPhase = true;

			return {
				result: ls('tools.advancePhase.messages.success', {
					current: getLocalizedActPhase(effectiveCurrentPhase),
					next: getLocalizedActPhase(nextPhase),
				}),
			};
		},
	});
}

export function allowAdvancePhaseTools(plotMode: string, actPhase: ActPhase | null): boolean {
	return plotMode === 'phaseEvent' && actPhase !== 'resolution';
}

export function buildAdvancePhaseTools(actLineId: string, currentPhase: ActPhase | null, assistant: AssistantContext): ToolSet {
	return {
		'advance-phase': createAdvancePhaseTool(actLineId, currentPhase, assistant),
	};
}
