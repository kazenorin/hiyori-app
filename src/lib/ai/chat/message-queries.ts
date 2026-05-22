import type { NarrativeVariables, PlotMode } from '../narrative-types';
import type { PlayerContext } from '../pipeline/types';
import type { UIMessage } from '../chat.svelte';

export function findLastNonNullSceneNumber(messages: UIMessage[]): number | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].sceneNumber != null) return messages[i].sceneNumber;
	}
	return undefined;
}

export function getLatestActSummary(messages: UIMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].actSummary) return messages[i].actSummary!;
	}
	return '';
}

export function getScenePlotForScene(messages: UIMessage[], sceneNumber: number, plotMode: PlotMode): string {
	if (plotMode === 'guidance') {
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].sceneNumber === sceneNumber && messages[i].scenePlot) {
				return messages[i].scenePlot!;
			}
		}
	} else if (plotMode === 'phaseEvent') {
		for (let i = messages.length - 1; i >= 0; i--) {
			const scenePlot = messages[i].scenePlot;
			if (scenePlot) return scenePlot;
		}
	}

	return '';
}

export function getPreviousNarrativeMessage(messages: UIMessage[]): NarrativeVariables | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role === 'assistant' && message.variables?.narrativeBody) return message.variables;
	}
	return undefined;
}

export function getPlayerContext(messages: UIMessage[]): PlayerContext | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'user') {
			return { playerResponse: messages[i].content, playerMessageId: messages[i].id };
		}
	}
	return undefined;
}
