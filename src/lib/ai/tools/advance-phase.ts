import { ls } from '$lib/localization';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolSet } from 'ai';
import type { ActLineMeta } from '$lib/db/act-lines';
import { advanceActPhase } from '$lib/db/act-lines';
import { getNextActPhase } from '$lib/ai/narrative-types';

interface AdvanceGuard {
	hasAdvanced: boolean;
}

export function createAdvancePhaseTool(actLine: ActLineMeta, advanceGuard: AdvanceGuard) {
	return tool({
		description: ls('tools.advancePhase.description'),
		inputSchema: z.object({}),
		execute: async (): Promise<{ result: string }> => {
			if (advanceGuard.hasAdvanced) {
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
			advanceGuard.hasAdvanced = true;

			return {
				result: ls('tools.advancePhase.success', {
					current: currentPhase,
					next: nextPhase,
				}),
			};
		},
	});
}

export function buildAdvancePhaseTools(actLine: ActLineMeta, advanceGuard: AdvanceGuard): ToolSet {
	return {
		'advance-phase': createAdvancePhaseTool(actLine, advanceGuard),
	};
}
