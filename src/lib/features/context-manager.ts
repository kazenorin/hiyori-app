import { getActLine, getLatestActShortSummaryEntry, updateActShortSummary } from '#lib/db/act-lines';
import { traceActLineChain } from '#lib/db/acts';
import { findScenePlotMessage } from '#lib/ai/chat/message-queries';
import type { UIMessage } from '#lib/ai/chat/types';
import type { PlotMode } from '#lib/ai/narrative-types';

export interface ScenePlotContext {
	messageId: string;
	scenePlot: string;
	ownerSceneNumber: number;
	editable: boolean;
}

export interface StorySoFarEntry {
	eventId: string;
	actLineId: string;
	actNumber: number;
	lineName: string;
	isMainLine: boolean;
	value: string;
}

export function resolveScenePlot(
	messages: UIMessage[],
	clickedSceneNumber: number,
	plotMode: PlotMode,
	lastSceneNumber: number | null
): ScenePlotContext | null {
	const owner = findScenePlotMessage(messages, clickedSceneNumber, plotMode);
	if (!owner?.scenePlot) return null;
	return {
		messageId: owner.id,
		scenePlot: owner.scenePlot,
		ownerSceneNumber: owner.sceneNumber,
		editable: lastSceneNumber !== null && owner.sceneNumber === lastSceneNumber,
	};
}

/** Mirrors run-manager.ts:600-608 — this list IS previousActSummaries, newest act first. */
export async function getStorySoFar(actLineId: string): Promise<StorySoFarEntry[]> {
	const chain = await traceActLineChain(actLineId);
	const ancestors = chain.slice(0, -1).reverse();
	const entries: StorySoFarEntry[] = [];
	for (const ancestor of ancestors) {
		const summary = await getLatestActShortSummaryEntry(ancestor.actLineId);
		if (!summary?.value) continue;
		const line = await getActLine(ancestor.actLineId);
		entries.push({
			eventId: summary.eventId,
			actLineId: ancestor.actLineId,
			actNumber: ancestor.actNumber,
			lineName: line?.name ?? '',
			isMainLine: ancestor.isMainLine,
			value: summary.value,
		});
	}
	return entries;
}

export async function saveActShortSummary(eventId: string, value: string): Promise<void> {
	await updateActShortSummary(eventId, value.trim());
}
