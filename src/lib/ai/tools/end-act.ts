import { ls } from '$lib/localization';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolSet } from 'ai';
import { recordEnding } from '$lib/db/act-lines';
import type { EndingType, ActPhase } from '$lib/ai/narrative-types';
import { getActPhaseIndex } from '$lib/ai/narrative-types';
import type { AssistantContext } from '$lib/ai/pipeline/types';
import { log } from './utils';

const ENDING_LABELS: Record<EndingType, string> = {
	good: 'common.descriptions.endings.good',
	bad: 'common.descriptions.endings.bad',
	bittersweet: 'common.descriptions.endings.bittersweet',
	alternative: 'common.descriptions.endings.alternative',
};

function getEndingLabel(endingType: EndingType): string {
	return ls(ENDING_LABELS[endingType]);
}

export function createEndActTool(actLineId: string, plotMode: string, actPhase: ActPhase | null, assistant: AssistantContext) {
	let hasEndedAct = false;

	return tool({
		description: ls('tools.endAct.description', {
			good: ls(ENDING_LABELS.good),
			bad: ls(ENDING_LABELS.bad),
			bittersweet: ls(ENDING_LABELS.bittersweet),
			alternative: ls(ENDING_LABELS.alternative),
		}),
		inputSchema: z.object({
			endingType: z
				.enum(['good', 'bad', 'bittersweet', 'alternative'])
				.describe('Which of the Possible Endings from the Act Plot the story has reached'),
		}),
		execute: async ({ endingType }): Promise<{ result: string }> => {
			if (hasEndedAct) {
				await log('end-act triggered: already ended');
				return { result: ls('tools.endAct.alreadyEnded') };
			}

			if (plotMode === 'phaseEvent' && actPhase) {
				const phaseIndex = getActPhaseIndex(actPhase);
				const minIndex = getActPhaseIndex('falling-action');
				if (phaseIndex < minIndex) {
					await log('end-act triggered: ending too early');
					return { result: ls('tools.endAct.tooEarly') };
				}
			}

			await recordEnding(actLineId, assistant, endingType as EndingType);
			await log(`end-act triggered: ending act as ${endingType}`);
			hasEndedAct = true;

			return {
				result: ls('tools.endAct.success', { endingType: getEndingLabel(endingType as EndingType) }),
			};
		},
	});
}

export function allowEndActTools(isEnded: boolean): boolean {
	return !isEnded;
}

export function buildEndActTools(
	actLineId: string,
	plotMode: string,
	actPhase: ActPhase | null,
	isEnded: boolean,
	assistant: AssistantContext
): ToolSet {
	return {
		'end-act': createEndActTool(actLineId, plotMode, actPhase, assistant),
	};
}
