import { parseCharacterAliases } from '../act-summary-parser';
import { ERR_INVALID_MESSAGE_ROLE, ERR_MESSAGE_SEQUENCE_NOT_FOUND } from '$lib/definitions/error-messages';
import * as dbActLines from '$lib/db/act-lines';
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

export function getLatestDecisions(messages: UIMessage[]): string[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'assistant' && messages[i].variables?.gameData?.decisions?.length) {
			return messages[i].variables!.gameData!.decisions;
		}
	}
	return [];
}

export function getLatestActivePlotThreads(messages: UIMessage[]): string[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'assistant' && messages[i].variables?.gameData?.activePlotThreads?.length) {
			return messages[i].variables!.gameData!.activePlotThreads;
		}
	}
	return [];
}

export function getLatestDecisionContext(messages: UIMessage[]): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'assistant' && messages[i].variables?.gameData?.decisionContext) {
			return messages[i].variables!.gameData!.decisionContext;
		}
	}
	return null;
}

export function getCharacterNames(messages: UIMessage[]): string[] {
	const actSummary = getLatestActSummary(messages);
	if (!actSummary) return [];
	const entries = parseCharacterAliases(actSummary);
	const names: string[] = [];
	for (const entry of entries) {
		names.push(entry.characterName);
		names.push(...entry.aliases);
	}
	return names;
}

export function isUserMessage(message: UIMessage): boolean {
	return message.role === 'user';
}

export async function getForkSequence(
	actLineId: string,
	messages: UIMessage[],
	assistantMessageIndex: number
): Promise<{ branchSeq: number; name: string }> {
	const assistantMsg = messages[assistantMessageIndex];
	if (!assistantMsg || assistantMsg.role !== 'assistant') {
		throw new Error(ERR_INVALID_MESSAGE_ROLE);
	}

	const assistantSeq = await dbActLines.getMessageSequence(actLineId, assistantMsg.id);
	if (assistantSeq === null) throw new Error(ERR_MESSAGE_SEQUENCE_NOT_FOUND);

	const sceneTitle = assistantMsg.variables?.sceneTitle;
	const sceneLabel = sceneTitle ? `Scene ${assistantMsg.sceneNumber}: ${sceneTitle}` : `Scene ${assistantMsg.sceneNumber}`;

	return {
		branchSeq: assistantSeq,
		name: `Fork from "${sceneLabel}"`,
	};
}
