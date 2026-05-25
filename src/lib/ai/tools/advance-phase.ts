import { ls } from '$lib/localization';
import type { ToolSet } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import { recordActPhaseTransition } from '$lib/db/act-lines';
import type { ActPhase } from '$lib/ai/narrative-types';
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
		inputSchema: z.object({}),
		execute: async (): Promise<{ result: string }> => {

			if (hasAdvancedPhase) {
				await log('advance-phase triggered: already advanced');
				return { result: ls('tools.advancePhase.alreadyAdvanced') };
			}

			if (!currentPhase) {
				await log('advance-phase triggered: current phase is null, treated as terminal phase');
				return { result: ls('tools.advancePhase.terminalPhase') };
			}

			const nextPhase = getNextActPhase(currentPhase);
			if (!nextPhase) {
				await log('advance-phase triggered: already terminal phase');
				return { result: ls('tools.advancePhase.terminalPhase') };
			}

			await recordActPhaseTransition(actLineId, assistant, nextPhase);
			await log(`advance-phase triggered: advancing to ${nextPhase}`);
			hasAdvancedPhase = true;

			return {
				result: ls('tools.advancePhase.success', {
					current: getLocalizedActPhase(currentPhase),
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
