import JSZip from 'jszip';
import { upsertStory, createStory } from '$lib/db/stories';
import { upsertStoryFolder, setStoryFolder } from '$lib/db/story-folders';
import { upsertAct, insertAct, type Act } from '$lib/db/acts';
import {
	getActLine,
	deleteActLine,
	insertActLineMeta,
	insertActLineEvents,
	insertActLineEntries,
	insertActLinePremises,
	type ActLineMeta,
	type ActLineEvent,
	type ActLineEntry,
} from '$lib/db/act-lines';
import { insertDirectorNote, type DirectorNote } from '$lib/db/director-notes';
import { upsertMessage, insertMessage, type Message, parseVariables } from '$lib/db/messages';
import { insertCharacterProfile, type InsertCharacterProfileInput, type CharacterImportance } from '$lib/db/character-profiles';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { fs } from '$lib/fs/file-system';
import { loadStories, selectStory } from '$lib/stores/stories.svelte';
import type { StoryExportData } from './archive-schema';
import { regenerateIds } from './id-remapper';

export type LoadMode = 'overwrite' | 'new';

export interface LoadResult {
	success: boolean;
	storyId: string;
	error?: string;
}

function toActLineMeta(meta: StoryExportData['actLineMeta'][number]): ActLineMeta {
	return {
		id: meta.id,
		actId: meta.actId,
		name: meta.name,
		isMainLine: meta.isMainLine,
		createdAt: meta.createdAt,
		plotMode: meta.plotMode as ActLineMeta['plotMode'],
	};
}

function toActLineEvents(events: StoryExportData['actLineEvents'], selectedActLineIds: Set<string>): ActLineEvent[] {
	return events
		.filter((e) => selectedActLineIds.has(e.actLineId))
		.map((e) => ({
			id: e.id,
			actLineId: e.actLineId,
			messageId: e.messageId,
			messageSequence: e.messageSequence,
			event: e.event as ActLineEvent['event'],
			value: e.value,
			createdAt: e.createdAt,
		}));
}

function toActLineEntries(entries: StoryExportData['actLineEntries'], selectedActLineIds: Set<string>): ActLineEntry[] {
	return entries
		.filter((e) => selectedActLineIds.has(e.actLineId))
		.map((e) => ({
			actLineId: e.actLineId,
			messageId: e.messageId,
			sequence: e.sequence,
		}));
}

function toActLinePremises(premises: StoryExportData['actLinePremises'], selectedActLineIds: Set<string>): ActLineEntry[] {
	return premises
		.filter((p) => selectedActLineIds.has(p.actLineId))
		.map((p) => ({
			actLineId: p.actLineId,
			messageId: p.messageId,
			sequence: p.sequence,
		}));
}

function toDirectorNotes(notes: StoryExportData['directorNotes'], selectedActLineIds: Set<string>): DirectorNote[] {
	return notes
		.filter((n) => selectedActLineIds.has(n.actLineId))
		.map((n) => ({
			id: n.id,
			actLineId: n.actLineId,
			text: n.text,
			isActive: n.isActive,
			effectiveFromScene: n.effectiveFromScene,
			effectiveToScene: n.effectiveToScene,
			createdAt: n.createdAt,
		}));
}

function toMessages(messages: StoryExportData['messages'], messageIds: Set<string>): Message[] {
	return messages
		.filter((m) => messageIds.has(m.id))
		.map((m) => ({
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
		}));
}

function toCharacterProfileInputs(
	profiles: NonNullable<StoryExportData['characterProfiles']>,
	selectedActLineIds: Set<string>
): InsertCharacterProfileInput[] {
	return profiles
		.filter((p) => selectedActLineIds.has(p.actLineId))
		.map((p) => ({
			id: p.id,
			actLineId: p.actLineId,
			sceneNumber: p.sceneNumber,
			canonicalName: p.canonicalName,
			preferredName: p.preferredName,
			aliases: p.aliases,
			state: p.state,
			goal: p.goal,
			relationships: p.relationships,
			voice: p.voice,
			sceneDetails: p.sceneDetails,
			importance: p.importance as CharacterImportance,
			createdAt: p.createdAt,
			updatedAt: p.updatedAt,
		}));
}

export function collectMessageIds(entries: ActLineEntry[], premises: ActLineEntry[], events: ActLineEvent[]): Set<string> {
	const ids = new Set<string>();
	for (const e of entries) ids.add(e.messageId);
	for (const p of premises) ids.add(p.messageId);
	for (const evt of events) {
		if (evt.messageId) ids.add(evt.messageId);
	}
	return ids;
}

function toAct(act: StoryExportData['acts'][number]): Act {
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

async function insertSelectedActLineData(data: StoryExportData, selectedActLineIds: Set<string>, overwrite: boolean): Promise<void> {
	const selectedMeta = data.actLineMeta.filter((m) => selectedActLineIds.has(m.id));

	for (const meta of selectedMeta) {
		if (overwrite) {
			const existingLine = await getActLine(meta.id);
			if (existingLine) {
				await deleteActLine(meta.id);
			}
		}

		await insertActLineMeta(toActLineMeta(meta));
	}

	const selectedEvents = toActLineEvents(data.actLineEvents, selectedActLineIds);
	const selectedEntries = toActLineEntries(data.actLineEntries, selectedActLineIds);
	const selectedPremises = toActLinePremises(data.actLinePremises, selectedActLineIds);

	await insertActLineEvents(selectedEvents);
	await insertActLineEntries(selectedEntries);
	await insertActLinePremises(selectedPremises);

	const selectedNotes = toDirectorNotes(data.directorNotes, selectedActLineIds);
	for (const note of selectedNotes) {
		await insertDirectorNote(note);
	}

	const lineMessageIds = collectMessageIds(selectedEntries, selectedPremises, selectedEvents);
	const selectedMessages = toMessages(data.messages, lineMessageIds);
	for (const msg of selectedMessages) {
		if (overwrite) {
			await upsertMessage(msg);
		} else {
			await insertMessage(msg);
		}
	}

	if (data.characterProfiles) {
		const selectedProfiles = toCharacterProfileInputs(data.characterProfiles, selectedActLineIds);
		for (const profile of selectedProfiles) {
			await insertCharacterProfile(profile);
		}
	}
}

function collectRequiredActIds(data: StoryExportData, selectedActLineIds: Set<string>): Set<string> {
	const actIdsWithSelectedLines = new Set<string>();
	for (const meta of data.actLineMeta) {
		if (selectedActLineIds.has(meta.id)) {
			actIdsWithSelectedLines.add(meta.actId);
		}
	}

	const actMap = new Map(data.acts.map((a) => [a.id, a]));
	const requiredActIds = new Set(actIdsWithSelectedLines);

	for (const actId of actIdsWithSelectedLines) {
		let currentAct = actMap.get(actId);
		while (currentAct?.continuesFromActLineId) {
			const parentLine = data.actLineMeta.find((m) => m.id === currentAct!.continuesFromActLineId);
			if (!parentLine) break;
			requiredActIds.add(parentLine.actId);
			currentAct = actMap.get(parentLine.actId);
		}
	}

	return requiredActIds;
}

export async function loadStoryOverwrite(data: StoryExportData, selectedLineIds: string[], zip: JSZip): Promise<LoadResult> {
	const storyId = data.story.id;

	try {
		await upsertStory(storyId, data.story.name, data.story.locale, data.story.createdAt);
		await upsertStoryFolder(storyId, data.storyFolder.folderName, data.storyFolder.createdAt);

		const selectedActLineIds = new Set(selectedLineIds);
		const requiredActIds = collectRequiredActIds(data, selectedActLineIds);

		for (const act of data.acts) {
			if (requiredActIds.has(act.id)) {
				await upsertAct(toAct(act));
			}
		}

		await insertSelectedActLineData(data, selectedActLineIds, true);

		await writeFilesFromZip(zip, data.storyFolder.folderName, data.storyFolder.folderName);

		await loadStories();
		await selectStory(storyId);

		return { success: true, storyId };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { success: false, storyId, error: message };
	}
}

export async function loadStoryAsNew(data: StoryExportData, selectedLineIds: string[], zip: JSZip): Promise<LoadResult> {
	const { data: remapped, idMap, newStoryId } = regenerateIds(data);

	try {
		await createStory(newStoryId, remapped.story.name, remapped.story.locale);
		const folderName = await resolveStoryFolder(newStoryId, remapped.story.name);
		await setStoryFolder(newStoryId, folderName);

		const remappedSelectedIds = new Set<string>();
		for (const origId of selectedLineIds) {
			const newId = idMap.get(origId);
			if (newId) remappedSelectedIds.add(newId);
		}

		const requiredActIds = collectRequiredActIds(remapped, remappedSelectedIds);

		for (const act of remapped.acts) {
			if (requiredActIds.has(act.id)) {
				await insertAct(toAct(act));
			}
		}

		await insertSelectedActLineData(remapped, remappedSelectedIds, false);

		await writeFilesFromZip(zip, data.storyFolder.folderName, folderName, idMap);

		await loadStories();
		await selectStory(newStoryId);

		return { success: true, storyId: newStoryId };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { success: false, storyId: newStoryId, error: message };
	}
}

async function writeFilesFromZip(
	zip: JSZip,
	sourceFolderName: string,
	targetFolderName: string,
	idMap?: Map<string, string>
): Promise<void> {
	const folderPrefix = sourceFolderName + '/';
	const fileEntries: string[] = [];

	zip.forEach((relativePath) => {
		if (relativePath.startsWith(folderPrefix) && !relativePath.endsWith('/')) {
			fileEntries.push(relativePath);
		}
	});

	if (fileEntries.length === 0) return;

	await fs.mkdir(targetFolderName).catch(() => {});

	for (const zipPath of fileEntries) {
		const zipEntry = zip.file(zipPath);
		if (!zipEntry) continue;

		let relativeFromFolder = zipPath.slice(folderPrefix.length);

		if (idMap) {
			const segments = relativeFromFolder.split('/');
			for (let i = 0; i < segments.length; i++) {
				const mapped = idMap.get(segments[i]);
				if (mapped) segments[i] = mapped;
			}
			relativeFromFolder = segments.join('/');
		}

		const fsPath = `${targetFolderName}/${relativeFromFolder}`;

		try {
			const content = await zipEntry.async('string');
			await fs.writeTextFileEnsuringDir(fsPath, content);
		} catch (err) {
			console.warn(`Skipping file ${zipPath} in load: ${err}`);
		}
	}
}
