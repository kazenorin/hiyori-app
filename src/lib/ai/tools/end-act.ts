import { ls } from '$lib/localization';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolSet } from 'ai';
import type { ActLineMeta } from '$lib/db/act-lines';
import { endActLine } from '$lib/db/act-lines';
import type { EndingType } from '$lib/ai/narrative-types';
import { getActPhaseIndex } from '$lib/ai/narrative-types';

const endingLabels: Record<EndingType, string> = {
	good: ls('tools.endAct.endingGood'),
	bad: ls('tools.endAct.endingBad'),
	bittersweet: ls('tools.endAct.endingBittersweet'),
	alternative: ls('tools.endAct.endingAlternative'),
};

export function createEndActTool(actLine: ActLineMeta) {
	let hasEndedAct = false;

	return tool({
		description: ls('tools.endAct.description', {
			good: ls('tools.endAct.endingGood'),
			bad: ls('tools.endAct.endingBad'),
			bittersweet: ls('tools.endAct.endingBittersweet'),
			alternative: ls('tools.endAct.endingAlternative'),
		}),
		inputSchema: z.object({
			endingType: z
				.enum(['good', 'bad', 'bittersweet', 'alternative'])
				.describe('Which of the Possible Endings from the Act Plot the story has reached'),
		}),
		execute: async ({ endingType }): Promise<{ result: string }> => {
			if (hasEndedAct) {
				return { result: ls('tools.endAct.alreadyEnded') };
			}

			if (actLine.endedAt !== null) {
				return { result: ls('tools.endAct.alreadyEnded') };
			}

			if (actLine.plotMode === 'phaseEvent' && actLine.actPhase) {
				const phaseIndex = getActPhaseIndex(actLine.actPhase);
				const minIndex = getActPhaseIndex('falling-action');
				if (phaseIndex < minIndex) {
					return { result: ls('tools.endAct.tooEarly') };
				}
			}

			await endActLine(actLine.id, endingType as EndingType);
			hasEndedAct = true;

			return {
				result: ls('tools.endAct.success', { endingType: endingLabels[endingType as EndingType] }),
			};
		},
	});
}

export function allowEndActTools(actLine: ActLineMeta) {
	return actLine.endedAt === null;
}

export function buildEndActTools(actLine: ActLineMeta): ToolSet {
	return {
		'end-act': createEndActTool(actLine),
	};
}
