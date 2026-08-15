import {
	createActLine,
	getActLine,
	getMessagesForLine,
	insertActLineEntries,
	insertActLineMeta,
	removeMessagesFromActLine,
	type ActLineMeta,
} from '$lib/db/act-lines';
import { getMessagesByIds, insertMessage, parseVariables, type Message } from '$lib/db/messages';
import { getStory } from '$lib/db/stories';
import JSZip from 'jszip';
import type { StoryExportData } from '$lib/features/story-export-load/archive-schema';
import { loadStoryOverwrite } from '$lib/features/story-export-load/story-loader';

export type LineageDecision = 'identical' | 'remote-stale' | 'local-stale' | 'divergent';

export interface LineageComparison {
	decision: LineageDecision;
	commonPrefixLength: number;
}

/**
 * Compares ordered message-ID lineages of one act line (local vs incoming).
 * Sequential-use sync model: both sides derive from a common synced ancestor,
 * so a shared prefix is guaranteed and the comparison is prefix-based.
 */
export function compareLineages(local: string[], incoming: string[]): LineageComparison {
	let commonPrefixLength = 0;
	while (
		commonPrefixLength < local.length &&
		commonPrefixLength < incoming.length &&
		local[commonPrefixLength] === incoming[commonPrefixLength]
	) {
		commonPrefixLength++;
	}

	if (commonPrefixLength === local.length && commonPrefixLength === incoming.length) {
		return { decision: 'identical', commonPrefixLength };
	}
	if (commonPrefixLength === incoming.length) {
		return { decision: 'remote-stale', commonPrefixLength };
	}
	if (commonPrefixLength === local.length) {
		return { decision: 'local-stale', commonPrefixLength };
	}
	return { decision: 'divergent', commonPrefixLength };
}

export type MergeAction = 'no-op' | 'fast-forward' | 'forked';

export interface MergeIncomingInput {
	actLineId: string;
	incomingEntries: { actLineId: string; messageId: string; sequence: number }[];
	incomingMessages: Message[];
	forkNameSuffix: string;
}

export interface MergeResult {
	action: MergeAction;
	forkActLineId?: string;
}

export async function mergeIncomingActLine(input: MergeIncomingInput): Promise<MergeResult> {
	const localIds = (await getMessagesForLine(input.actLineId)).map((m) => m.id);
	const incomingSorted = [...input.incomingEntries].sort((a, b) => a.sequence - b.sequence);
	const incomingIds = incomingSorted.map((e) => e.messageId);

	const { decision } = compareLineages(localIds, incomingIds);
	if (decision === 'identical' || decision === 'remote-stale') {
		return { action: 'no-op' };
	}

	// Add-only message rule: only insert IDs missing locally; never overwrite.
	const existing = new Set((await getMessagesByIds(incomingIds)).map((m) => m.id));
	for (const message of input.incomingMessages) {
		if (!existing.has(message.id)) await insertMessage(message);
	}

	if (decision === 'local-stale') {
		const newEntries = incomingSorted
			.filter((e) => e.sequence >= localIds.length)
			.map((e) => ({ actLineId: input.actLineId, messageId: e.messageId, sequence: e.sequence }));
		await insertActLineEntries(newEntries);
		return { action: 'fast-forward' };
	}

	// Divergent: fork local first so message reference counts stay > 0, then
	// yield the original act-line ID to the incoming lineage.
	const meta = await getActLine(input.actLineId);
	if (!meta) throw new Error(`Act line ${input.actLineId} not found during merge`);

	const fork = await createActLine(
		crypto.randomUUID(),
		meta.actId,
		`${meta.name} ${input.forkNameSuffix}`,
		false,
		meta.plotMode
	);
	await insertActLineEntries(
		localIds.map((messageId, sequence) => ({ actLineId: fork.id, messageId, sequence }))
	);
	await removeMessagesFromActLine(input.actLineId, localIds);
	await insertActLineEntries(
		incomingSorted.map((e) => ({ actLineId: input.actLineId, messageId: e.messageId, sequence: e.sequence }))
	);

	return { action: 'forked', forkActLineId: fork.id };
}

export type StoryMergeResult = 'new-story' | 'merged' | 'up-to-date';

function toIncomingMessage(m: StoryExportData['messages'][number]): Message {
	return {
		id: m.id,
		role: m.role as Message['role'],
		content: m.content,
		reasoning: m.reasoning ?? undefined,
		metadata: m.metadata ?? undefined,
		variables: parseVariables(m.variables),
		actSummary: m.actSummary ?? undefined,
		scenePlot: m.scenePlot ?? undefined,
		importantPhrases: m.importantPhrases ?? undefined,
		sceneNumber: m.sceneNumber ?? undefined,
		createdAt: m.createdAt,
	};
}

export async function mergeIncomingStory(zipData: Uint8Array): Promise<StoryMergeResult> {
	const zip = await JSZip.loadAsync(zipData);
	const dataFile = zip.file('story-data.json');
	if (!dataFile) throw new Error('Invalid cloud archive: missing story-data.json');
	const data = JSON.parse(await dataFile.async('string')) as StoryExportData;

	const localStory = await getStory(data.story.id);
	if (!localStory) {
		// New story: load with IDs preserved. NEVER remap — story identity by
		// storyId is what makes lineage comparison work on later syncs.
		const allLineIds = data.actLineMeta.map((m) => m.id);
		const result = await loadStoryOverwrite(data, allLineIds, zip);
		if (!result.success) throw new Error(`Failed to import synced story: ${result.error}`);
		return 'new-story';
	}

	const messageById = new Map(data.messages.map((m) => [m.id, m]));
	const incomingByLine = new Map<string, typeof data.actLineEntries>();
	for (const entry of data.actLineEntries) {
		const list = incomingByLine.get(entry.actLineId) ?? [];
		list.push(entry);
		incomingByLine.set(entry.actLineId, list);
	}

	let anyChange = false;
	for (const [actLineId, entries] of incomingByLine) {
		const ids = [...new Set(entries.map((e) => e.messageId))];
		const incomingMessages = ids
			.map((id) => messageById.get(id))
			.filter((m): m is NonNullable<typeof m> => !!m)
			.map(toIncomingMessage);

		const localLine = await getActLine(actLineId);
		if (!localLine) {
			// Line created on the other device (e.g. a fork made there): import whole.
			const meta = data.actLineMeta.find((m) => m.id === actLineId);
			if (!meta) continue;
			await insertActLineMeta({
				id: meta.id,
				actId: meta.actId,
				name: meta.name,
				isMainLine: meta.isMainLine,
				createdAt: meta.createdAt,
				plotMode: meta.plotMode as ActLineMeta['plotMode'],
			});
			// Add-only rule applies here too: shared-prefix messages may exist already.
			const existing = new Set((await getMessagesByIds(ids)).map((m) => m.id));
			for (const message of incomingMessages) {
				if (!existing.has(message.id)) await insertMessage(message);
			}
			await insertActLineEntries(
				entries.map((e) => ({ actLineId: e.actLineId, messageId: e.messageId, sequence: e.sequence }))
			);
			anyChange = true;
			continue;
		}

		const result = await mergeIncomingActLine({
			actLineId,
			incomingEntries: entries,
			incomingMessages,
			forkNameSuffix: '(local branch)',
		});
		if (result.action !== 'no-op') anyChange = true;
	}
	return anyChange ? 'merged' : 'up-to-date';
}
