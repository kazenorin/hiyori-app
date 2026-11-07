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
	body: string;
	marker: string;
}

/**
 * The trailing marker is an ls() string resolved against the story locale, which may differ from
 * the UI locale. Peel it off for editing and re-append it verbatim; never recompute it.
 */
export function splitSceneCountMarker(value: string): { body: string; marker: string } {
	const match = /^(.*?)\s*(\[[^\]]*\])$/s.exec(value);
	if (!match) return { body: value, marker: '' };
	return { body: match[1], marker: match[2] };
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
		const { body, marker } = splitSceneCountMarker(summary.value);
		entries.push({
			eventId: summary.eventId,
			actLineId: ancestor.actLineId,
			actNumber: ancestor.actNumber,
			lineName: line?.name ?? '',
			isMainLine: ancestor.isMainLine,
			body,
			marker,
		});
	}
	return entries;
}

export async function saveActShortSummary(eventId: string, body: string, marker: string): Promise<void> {
	const value = marker ? `${body.trim()} ${marker}` : body.trim();
	await updateActShortSummary(eventId, value);
}
