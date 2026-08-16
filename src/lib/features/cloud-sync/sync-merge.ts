import {
	branchFromLine,
	deleteActLine,
	getActLine,
	getActLineEventsForLines,
	getActLinePremisesForLines,
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
import {
	cloneCharacterProfiles,
	getCharacterProfilesForActLines,
	insertCharacterProfile,
	type InsertCharacterProfileInput,
} from '$lib/db/character-profiles';
import { cloneDirectorNotes, getDirectorNotesForActLines, insertDirectorNote, type DirectorNote } from '$lib/db/director-notes';
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

export type MergeAction = 'no-op' | 'fast-forward' | 'forked' | 'merged';

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

/**
 * Whether every piece of the local line's line-local state exists in the
 * incoming archive: events by id, premises by (messageId, sequence), notes by
 * content tuple, profiles by (id, updatedAt). compareLineages only sees
 * message chains, so a local-stale lineage alone doesn't prove the incoming
 * copy can take over the line — a note added locally after the last sync is a
 * deviation the prefix can't express. When this fails, the merge escalates to
 * fork-and-yield so local state survives on the fork instead of being
 * destroyed by delete-and-import. Undefined incoming arrays are treated as
 * empty, so any local state escalates (conservative).
 */
async function localStateSubsetOfIncoming(
	actLineId: string,
	incomingEvents: ActLineEvent[] | undefined,
	incomingPremises: ActLineEntry[] | undefined,
	incomingNotes: DirectorNote[] | undefined,
	incomingProfiles: InsertCharacterProfileInput[] | undefined
): Promise<boolean> {
	const [localEvents, localPremises, localNotes, localProfiles] = await Promise.all([
		getActLineEventsForLines([actLineId]),
		getActLinePremisesForLines([actLineId]),
		getDirectorNotesForActLines([actLineId]),
		getCharacterProfilesForActLines([actLineId]),
	]);

	// Events are append-only records — same id implies same content.
	const incomingEventIds = new Set((incomingEvents ?? []).map((e) => e.id));
	for (const event of localEvents) {
		if (!incomingEventIds.has(event.id)) return false;
	}

	const incomingPremiseKeys = new Set((incomingPremises ?? []).map((p) => `${p.messageId}:${p.sequence}`));
	for (const premise of localPremises) {
		if (!incomingPremiseKeys.has(`${premise.messageId}:${premise.sequence}`)) return false;
	}

	// Notes have no version field — compare the content tuple to catch edits.
	const incomingNoteFingerprints = new Set(
		(incomingNotes ?? []).map((n) => `${n.id}|${n.text}|${n.isActive}|${n.effectiveFromScene}|${n.effectiveToScene}`)
	);
	for (const note of localNotes) {
		if (!incomingNoteFingerprints.has(`${note.id}|${note.text}|${note.isActive}|${note.effectiveFromScene}|${note.effectiveToScene}`)) {
			return false;
		}
	}

	// Profiles are versioned: updatedAt is the mutation clock.
	const incomingProfileVersions = new Set((incomingProfiles ?? []).map((p) => `${p.id}:${p.updatedAt}`));
	for (const profile of localProfiles) {
		if (!incomingProfileVersions.has(`${profile.id}:${profile.updatedAt}`)) return false;
	}

	return true;
}

/**
 * Identical-lineage overlay: equal message chains mean neither side supersedes
 * the other, so incoming line-local state is unioned in by row identity.
 * Message rows are never touched (add-only rule). Returns whether anything was
 * imported.
 */
async function overlayIncomingLineState(input: MergeIncomingInput): Promise<boolean> {
	let imported = false;

	const eventIds = new Set((await getActLineEventsForLines([input.actLineId])).map((e) => e.id));
	for (const event of input.incomingEvents ?? []) {
		if (!eventIds.has(event.id)) {
			await insertActLineEvents([event]);
			imported = true;
		}
	}

	const premiseKeys = new Set((await getActLinePremisesForLines([input.actLineId])).map((p) => `${p.messageId}:${p.sequence}`));
	for (const premise of input.incomingPremises ?? []) {
		if (!premiseKeys.has(`${premise.messageId}:${premise.sequence}`)) {
			await insertActLinePremises([premise]);
			imported = true;
		}
	}

	const noteIds = new Set((await getDirectorNotesForActLines([input.actLineId])).map((n) => n.id));
	for (const note of input.incomingNotes ?? []) {
		if (!noteIds.has(note.id)) {
			await insertDirectorNote(note);
			imported = true;
		}
	}

	const profileIds = new Set((await getCharacterProfilesForActLines([input.actLineId])).map((p) => p.id));
	for (const profile of input.incomingProfiles ?? []) {
		if (!profileIds.has(profile.id)) {
			await insertCharacterProfile(profile);
			imported = true;
		}
	}

	return imported;
}

export async function mergeIncomingActLine(input: MergeIncomingInput): Promise<MergeResult> {
	const localIds = (await getMessagesForLine(input.actLineId)).map((m) => m.id);
	const incomingSorted = [...input.incomingEntries].sort((a, b) => a.sequence - b.sequence);
	const incomingIds = incomingSorted.map((e) => e.messageId);

	const { decision } = compareLineages(localIds, incomingIds);
	if (decision === 'remote-stale') {
		return { action: 'no-op' };
	}

	if (decision === 'identical') {
		// Equal message chains: no winner, so union the line-local state.
		const imported = await overlayIncomingLineState(input);
		return { action: imported ? 'merged' : 'no-op' };
	}

	// local-stale or divergent. A prefix lineage alone doesn't prove the
	// incoming copy can take over the line: line-local state added locally
	// after the last sync is invisible to compareLineages, so escalate to the
	// fork path — the fork preserves it, the main line becomes the import.
	const forkNeeded =
		decision === 'divergent' ||
		!(await localStateSubsetOfIncoming(
			input.actLineId,
			input.incomingEvents,
			input.incomingPremises,
			input.incomingNotes,
			input.incomingProfiles
		));

	let forkActLineId: string | null = null;
	if (forkNeeded) {
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
		forkActLineId = fork.id;

		// Rest of the forkActLine() workflow: carry the remaining line-local
		// state to the fork before the original line is deleted.
		await cloneDirectorNotes(input.actLineId, fork.id);
		const forkSceneNumber = await getSceneNumberAtSequence(input.actLineId, forkSequence);
		if (forkSceneNumber !== null) {
			await cloneCharacterProfiles(input.actLineId, fork.id, forkSceneNumber);
		}
		await cloneInventory(input.actLineId, fork.id);
		// Mirror the act-plot file onto the fork (forkActLine does the same;
		// only interview forks diverge and skip the copy).
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
	}

	// Delete the local copy, then import the incoming act line under the same
	// ID (save incoming). Fast-forward and divergent converge here.
	await deleteActLine(input.actLineId);

	// Add-only AFTER the delete: rows the delete orphan-cleansed are re-created
	// from the archive; rows referenced by another local line are untouched
	// (add-only holds wherever a global reference exists).
	const existing = new Set((await getMessagesByIds(incomingIds)).map((m) => m.id));
	for (const message of input.incomingMessages) {
		if (!existing.has(message.id)) await insertMessage(message);
	}

	await insertActLineMeta({
		id: input.incomingMeta.id,
		actId: input.incomingMeta.actId,
		name: input.incomingMeta.name,
		isMainLine: input.incomingMeta.isMainLine,
		createdAt: input.incomingMeta.createdAt,
		plotMode: input.incomingMeta.plotMode,
	});
	await insertActLineEntries(incomingSorted.map((e) => ({ actLineId: input.actLineId, messageId: e.messageId, sequence: e.sequence })));
	// The delete wiped the original rows, so the incoming rows cannot collide.
	await insertActLineEvents(input.incomingEvents ?? []);
	await insertActLinePremises(input.incomingPremises ?? []);
	for (const note of input.incomingNotes ?? []) {
		await insertDirectorNote(note);
	}
	for (const profile of input.incomingProfiles ?? []) {
		await insertCharacterProfile(profile);
	}

	return forkNeeded ? { action: 'forked', forkActLineId: forkActLineId! } : { action: 'fast-forward' };
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
			await insertActLineEntries(entries.map((e) => ({ actLineId: e.actLineId, messageId: e.messageId, sequence: e.sequence })));
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
