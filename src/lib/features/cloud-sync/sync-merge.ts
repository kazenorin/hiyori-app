import {
	createActLine,
	getActLine,
	getMessagesForLine,
	insertActLineEntries,
	insertActLineMeta,
	removeActLineJunctionRows,
	type ActLineMeta,
} from '$lib/db/act-lines';
import { getMessagesByIds, insertMessage, parseVariables, type Message } from '$lib/db/messages';
import { getStory } from '$lib/db/stories';
import { getAct, upsertAct, type Act } from '$lib/db/acts';
import { getDatabase } from '$lib/db/database';
import { getStoryFolderInfo } from '$lib/db/story-folders';
import JSZip from 'jszip';
import type { StoryExportData } from '$lib/features/story-export-load/archive-schema';
import { loadStoryOverwrite, writeFilesFromZip } from '$lib/features/story-export-load/story-loader';

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

	const { decision, commonPrefixLength } = compareLineages(localIds, incomingIds);
	if (decision === 'identical' || decision === 'remote-stale') {
		return { action: 'no-op' };
	}

	// Add-only message rule: only insert IDs missing locally; never overwrite.
	const existing = new Set((await getMessagesByIds(incomingIds)).map((m) => m.id));
	for (const message of input.incomingMessages) {
		if (!existing.has(message.id)) await insertMessage(message);
	}

	if (decision === 'local-stale') {
		// Slice by the shared prefix length, not sequence numbers: sequences are
		// 1-based and dense in production, so any sequence math here would
		// re-select the boundary entry and violate the junction primary key.
		const newEntries = incomingSorted
			.slice(commonPrefixLength)
			.map((e) => ({ actLineId: input.actLineId, messageId: e.messageId, sequence: e.sequence }));
		await insertActLineEntries(newEntries);
		return { action: 'fast-forward' };
	}

	// Divergent: fork local first so message reference counts stay > 0, then
	// yield the original act-line ID to the incoming lineage.
	const meta = await getActLine(input.actLineId);
	if (!meta) throw new Error(`Act line ${input.actLineId} not found during merge`);

	// Preserve the local line's 1-based sequences when forking.
	const db = getDatabase();
	const localRows = await db.select<{ message_id: string; sequence: number }[]>(
		'SELECT message_id, sequence FROM act_lines WHERE act_line_id = $1 ORDER BY sequence',
		[input.actLineId]
	);

	const fork = await createActLine(
		crypto.randomUUID(),
		meta.actId,
		`${meta.name} ${input.forkNameSuffix}`,
		false,
		meta.plotMode
	);
	await insertActLineEntries(
		localRows.map((row) => ({ actLineId: fork.id, messageId: row.message_id, sequence: row.sequence }))
	);
	// Junction rows only: the truncation cleanup in removeMessagesFromActLine
	// would cascade-delete this line's events and scene character profiles,
	// which must survive the yield on the forked local branch.
	await removeActLineJunctionRows(input.actLineId, localIds);
	// The fork carries the local branch's state: sequences are preserved above,
	// so events and profiles move across with a plain act-line-id rewrite.
	await db.execute('UPDATE act_line_events SET act_line_id = $1 WHERE act_line_id = $2', [fork.id, input.actLineId]);
	await db.execute('UPDATE character_profiles SET act_line_id = $1 WHERE act_line_id = $2', [fork.id, input.actLineId]);
	await insertActLineEntries(
		incomingSorted.map((e) => ({ actLineId: input.actLineId, messageId: e.messageId, sequence: e.sequence }))
	);

	return { action: 'forked', forkActLineId: fork.id };
}

export type StoryMergeResult = 'new-story' | 'merged' | 'up-to-date';

function toIncomingAct(act: StoryExportData['acts'][number]): Act {
	return {
		id: act.id,
		storyId: act.storyId,
		name: act.name,
		actNumber: act.actNumber,
		continuesFromActLineId: act.continuesFromActLineId,
		createdAt: act.createdAt,
		updatedAt: act.updatedAt,
	};
}

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
			// Lines of acts created on the other device would otherwise point at
			// a missing act row and become unreachable in the UI.
			if (!(await getAct(meta.actId))) {
				const act = data.acts.find((a) => a.id === meta.actId);
				if (act) await upsertAct(toIncomingAct(act));
			}
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

	// Story-folder files (prompts, world.md, …) travel with the archive, but
	// only apply them when this merge took incoming DB changes: pull fires on
	// any hash difference, and unconditional application would let a stale
	// remote archive overwrite newer local file edits. File-only remote
	// changes are a documented limitation (see README).
	if (anyChange) {
		const folder = await getStoryFolderInfo(data.story.id);
		if (folder?.folderName) {
			await writeFilesFromZip(zip, data.storyFolder.folderName, folder.folderName);
		}
	}

	return anyChange ? 'merged' : 'up-to-date';
}
