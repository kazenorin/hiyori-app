import {
	branchFromLine,
	deleteActLine,
	getActLine,
	getMessageIdsUpToSequence,
	getMessagesForLine,
	getNextSequence,
	getSceneNumberAtSequence,
	insertActLineEntries,
	insertActLineEvents,
	insertActLineMeta,
	insertActLinePremises,
	type ActLineEntry,
	type ActLineEvent,
	type ActLineMeta,
} from '$lib/db/act-lines';
import { getMessagesByIds, insertMessage, parseVariables, type Message } from '$lib/db/messages';
import { getStory } from '$lib/db/stories';
import { getAct, upsertAct, type Act } from '$lib/db/acts';
import { getStoryFolderInfo } from '$lib/db/story-folders';
import { cloneCharacterProfiles, insertCharacterProfile, type InsertCharacterProfileInput } from '$lib/db/character-profiles';
import { cloneDirectorNotes, insertDirectorNote, type DirectorNote } from '$lib/db/director-notes';
import { cloneInventory } from '$lib/db/inventory';
import { getMemoryProviderConfig, isMemoryAvailable } from '$lib/stores/settings.svelte';
import { log } from '$lib/logging/logger';
import { copyActPlotFileBetweenLines } from '$lib/ai/card-output-path';
import JSZip from 'jszip';
import type { StoryExportData } from '$lib/features/story-export-load/archive-schema';
import {
	loadStoryOverwrite,
	writeFilesFromZip,
	toActLineMeta,
	toActLineEvents,
	toActLinePremises,
	toDirectorNotes,
	toCharacterProfileInputs,
} from '$lib/features/story-export-load/story-loader';

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
	storyId: string;
	/** On-disk story folder name, used to mirror line files (e.g. act-plot). */
	storyFolder?: string;
	/** Incoming metadata for this act line — guaranteed to exist: the caller only
	 * merges conflicting lines (present on both sides). "Save incoming": the
	 * yielded line is an import of the incoming act line, so its metadata wins. */
	incomingMeta: ActLineMeta;
	incomingEntries: { actLineId: string; messageId: string; sequence: number }[];
	incomingMessages: Message[];
	/** Line-local incoming state, mirroring insertSelectedActLineData's per-line imports. */
	incomingEvents?: ActLineEvent[];
	incomingPremises?: ActLineEntry[];
	incomingNotes?: DirectorNote[];
	incomingProfiles?: InsertCharacterProfileInput[];
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
	// yield the original act-line ID to the incoming lineage. The merge IS a
	// fork of the conflicting line followed by a delete of the original —
	// mirroring forkActLine()/deleteActLine() — so the local branch keeps all
	// line-local state instead of hand-rolled SQL relocations.
	const meta = await getActLine(input.actLineId);
	if (!meta) throw new Error(`Act line ${input.actLineId} not found during merge`);

	// branchFromLine clones the fork-point message (so later metadata writes
	// don't pollute the yielded line) and carries junction entries, premises
	// and events over to the fork.
	const forkSequence = (await getNextSequence(input.actLineId)) - 1;
	const { lineMeta: fork, remappedMessageIds } = await branchFromLine(
		crypto.randomUUID(),
		input.actLineId,
		forkSequence,
		meta.actId,
		`${meta.name} ${input.forkNameSuffix}`,
		meta.plotMode
	);

	// Rest of the forkActLine() workflow: carry the remaining line-local state
	// to the fork before the original line is deleted.
	await cloneDirectorNotes(input.actLineId, fork.id);
	const forkSceneNumber = await getSceneNumberAtSequence(input.actLineId, forkSequence);
	if (forkSceneNumber !== null) {
		await cloneCharacterProfiles(input.actLineId, fork.id, forkSceneNumber);
	}
	await cloneInventory(input.actLineId, fork.id);
	// The fork is a mirror copy of the local line: carry the act-plot file
	// over like forkActLine() does, so opening the fork later doesn't
	// regenerate it through the LLM. Interview forks skip this because they're
	// meant to diverge; sync forks are not.
	const actForFork = await getAct(meta.actId);
	if (input.storyFolder && actForFork) {
		await copyActPlotFileBetweenLines({
			storyFolder: input.storyFolder,
			actNumber: actForFork.actNumber,
			sourceLineId: input.actLineId,
			sourceIsMainLine: meta.isMainLine,
			targetLineId: fork.id,
			targetName: fork.name,
		});
	}
	// Memory indices are desktop-only; guard exactly like the store's fork path.
	if (input.storyId && isMemoryAvailable()) {
		const config = getMemoryProviderConfig();
		if (config) {
			try {
				const { Memory } = await import('$lib/features/memory');
				const messageIds = await getMessageIdsUpToSequence(input.actLineId, forkSequence);
				// The fork-point clone carries a new id; keep memory refs aligned.
				const remappedIds = messageIds.map((id) => remappedMessageIds.get(id) ?? id);
				await new Memory(config).copyMemoriesForFork(input.storyId, input.actLineId, fork.id, remappedIds);
			} catch (err) {
				await log.error('cloud-sync', 'Failed to copy memories for forked line', err);
			}
		}
	}

	// Yield: remove the original line wholesale (junction rows, premises,
	// events, notes, profiles, inventory, metadata). deleteActLine also
	// orphan-cleans message rows no longer referenced by any line — the fork's
	// junction rows keep the local-branch messages alive, and the fork-point
	// message's content survives in its clone.
	await deleteActLine(input.actLineId);

	// "Save incoming": the incoming lineage takes over the original line ID as
	// an import of the incoming act line (insertSelectedActLineData semantics).
	// The incoming metadata replaces the local meta, whose name survives,
	// renamed, on the fork.
	await insertActLineMeta({
		id: input.incomingMeta.id,
		actId: input.incomingMeta.actId,
		name: input.incomingMeta.name,
		isMainLine: input.incomingMeta.isMainLine,
		createdAt: input.incomingMeta.createdAt,
		plotMode: input.incomingMeta.plotMode,
	});
	await insertActLineEntries(
		incomingSorted.map((e) => ({ actLineId: input.actLineId, messageId: e.messageId, sequence: e.sequence }))
	);
	// Line-local incoming state: the delete above wiped the original line's
	// rows, so the incoming rows below cannot collide. Message rows stay
	// add-only (inserted earlier): they are shared with the fork, and
	// overwriting them would corrupt the fork's view of the same rows.
	await insertActLineEvents(input.incomingEvents ?? []);
	await insertActLinePremises(input.incomingPremises ?? []);
	for (const note of input.incomingNotes ?? []) {
		await insertDirectorNote(note);
	}
	for (const profile of input.incomingProfiles ?? []) {
		await insertCharacterProfile(profile);
	}

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
	// Resolved once so the act-plot fork copy and the folder-file application
	// below share the same on-disk mapping.
	const storyFolder = (await getStoryFolderInfo(data.story.id))?.folderName;
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

		// Conflict: the line exists on both sides, so the archive also carries its
		// metadata (the exporter emits actLineMeta for every referenced line).
		const lineMeta = data.actLineMeta.find((m) => m.id === actLineId);
		if (!lineMeta) continue; // malformed archive

		const lineSet = new Set([actLineId]);
		const result = await mergeIncomingActLine({
			actLineId,
			storyId: data.story.id,
			storyFolder,
			incomingMeta: toActLineMeta(lineMeta),
			incomingEntries: entries,
			incomingMessages,
			incomingEvents: toActLineEvents(data.actLineEvents, lineSet),
			incomingPremises: toActLinePremises(data.actLinePremises, lineSet),
			incomingNotes: toDirectorNotes(data.directorNotes, lineSet),
			incomingProfiles: data.characterProfiles ? toCharacterProfileInputs(data.characterProfiles, lineSet) : [],
			forkNameSuffix: '(local branch)',
		});
		if (result.action !== 'no-op') anyChange = true;
	}

	// Story-folder files (prompts, world.md, …) travel with the archive, but
	// only apply them when this merge took incoming DB changes: pull fires on
	// any hash difference, and unconditional application would let a stale
	// remote archive overwrite newer local file edits. File-only remote
	// changes are a documented limitation (see README).
	if (anyChange && storyFolder) {
		await writeFilesFromZip(zip, data.storyFolder.folderName, storyFolder);
	}

	return anyChange ? 'merged' : 'up-to-date';
}
