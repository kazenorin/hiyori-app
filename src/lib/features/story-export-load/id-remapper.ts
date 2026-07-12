import type { StoryExportData } from './archive-schema';
import { CURRENT_ARCHIVE_VERSION } from './archive-schema';

export interface RemappedData {
	data: StoryExportData;
	idMap: Map<string, string>;
	newStoryId: string;
	newFolderName: string;
}

export function regenerateIds(data: StoryExportData): RemappedData {
	const idMap = new Map<string, string>();

	const newStoryId = crypto.randomUUID();
	idMap.set(data.story.id, newStoryId);

	for (const act of data.acts) {
		const newId = crypto.randomUUID();
		idMap.set(act.id, newId);
	}

	for (const meta of data.actLineMeta) {
		const newId = crypto.randomUUID();
		idMap.set(meta.id, newId);
	}

	for (const msg of data.messages) {
		idMap.set(msg.id, crypto.randomUUID());
	}

	for (const evt of data.actLineEvents) {
		idMap.set(evt.id, crypto.randomUUID());
	}

	for (const note of data.directorNotes) {
		idMap.set(note.id, crypto.randomUUID());
	}

	if (data.characterProfiles) {
		for (const p of data.characterProfiles) {
			idMap.set(p.id, crypto.randomUUID());
		}
	}

	const shortId = newStoryId.slice(-8);
	const newFolderName = `Story-${shortId}`;

	const remapped: StoryExportData = {
		version: CURRENT_ARCHIVE_VERSION,
		story: {
			...data.story,
			id: newStoryId,
		},
		storyFolder: {
			...data.storyFolder,
			storyId: newStoryId,
			folderName: newFolderName,
		},
		acts: data.acts.map((act) => ({
			...act,
			id: idMap.get(act.id) ?? act.id,
			storyId: newStoryId,
			continuesFromActLineId: act.continuesFromActLineId ? (idMap.get(act.continuesFromActLineId) ?? act.continuesFromActLineId) : null,
		})),
		actLineMeta: data.actLineMeta.map((meta) => ({
			...meta,
			id: idMap.get(meta.id) ?? meta.id,
			actId: idMap.get(meta.actId) ?? meta.actId,
		})),
		actLineEvents: data.actLineEvents.map((evt) => ({
			...evt,
			id: idMap.get(evt.id) ?? evt.id,
			actLineId: idMap.get(evt.actLineId) ?? evt.actLineId,
			messageId: evt.messageId ? (idMap.get(evt.messageId) ?? evt.messageId) : null,
		})),
		actLineEntries: data.actLineEntries.map((entry) => ({
			...entry,
			actLineId: idMap.get(entry.actLineId) ?? entry.actLineId,
			messageId: idMap.get(entry.messageId) ?? entry.messageId,
		})),
		actLinePremises: data.actLinePremises.map((prem) => ({
			...prem,
			actLineId: idMap.get(prem.actLineId) ?? prem.actLineId,
			messageId: idMap.get(prem.messageId) ?? prem.messageId,
		})),
		directorNotes: data.directorNotes.map((note) => ({
			...note,
			id: idMap.get(note.id) ?? note.id,
			actLineId: idMap.get(note.actLineId) ?? note.actLineId,
		})),
		messages: data.messages.map((msg) => ({
			...msg,
			id: idMap.get(msg.id) ?? msg.id,
		})),
		characterProfiles: data.characterProfiles?.map((p) => ({
			...p,
			id: idMap.get(p.id) ?? p.id,
			actLineId: idMap.get(p.actLineId) ?? p.actLineId,
		})),
	};

	return {
		data: remapped,
		idMap,
		newStoryId,
		newFolderName,
	};
}
