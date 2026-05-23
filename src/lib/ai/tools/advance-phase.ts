import { ls } from '$lib/localization';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolSet } from 'ai';
import type { ActLineMeta } from '$lib/db/act-lines';
import { advanceActPhase } from '$lib/db/act-lines';
import { getNextActPhase } from '$lib/ai/narrative-types';
import { getLocalizedActPhase } from '$lib/definitions/pipeline-prompts';

export function createAdvancePhaseTool(actLine: ActLineMeta) {
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
				return { result: ls('tools.advancePhase.alreadyAdvanced') };
			}

			const currentPhase = actLine.actPhase;
			if (!currentPhase) {
				return { result: ls('tools.advancePhase.terminalPhase') };
			}

			const nextPhase = getNextActPhase(currentPhase);
			if (!nextPhase) {
				return { result: ls('tools.advancePhase.terminalPhase') };
			}

			await advanceActPhase(actLine.id, nextPhase);
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

export function allowAdvancePhaseTools(actLine: ActLineMeta) {
	return actLine.plotMode === 'phaseEvent' && actLine.actPhase !== 'resolution';
}

export function buildAdvancePhaseTools(actLine: ActLineMeta): ToolSet {
	return {
		'advance-phase': createAdvancePhaseTool(actLine),
	};
}
