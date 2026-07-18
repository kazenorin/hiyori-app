import JSZip from 'jszip';
import { getStory } from '$lib/db/stories';
import { getActsForStory } from '$lib/db/acts';
import {
	getActLineMetasForStory,
	getActLineEventsForLines,
	getActLineEntriesForLines,
	getActLinePremisesForLines,
	type ActLineEvent,
	type ActLineEntry,
} from '$lib/db/act-lines';
import { getStoryFolderInfo } from '$lib/db/story-folders';
import { getDirectorNotesForActLines, type DirectorNote } from '$lib/db/director-notes';
import { getMessagesByIds, type Message } from '$lib/db/messages';
import { getCharacterProfilesForActLines } from '$lib/db/character-profiles';
import { fs } from '$lib/fs/file-system';
import { collectFilesInDir, isBinaryData } from '$lib/fs/file-tree';
import { downloadExport } from '$lib/db/data-portability';
import type { StoryExportData } from './archive-schema';
import { CURRENT_ARCHIVE_VERSION } from './archive-schema';
import { collectMessageIds } from './story-loader';

export async function exportStory(storyId: string): Promise<void> {
	const story = await getStory(storyId);
	if (!story) throw new Error('Story not found');

	const storyFolder = await getStoryFolderInfo(storyId);

	const acts = await getActsForStory(storyId);
	const actLineMetas = await getActLineMetasForStory(storyId);
	const actLineIds = actLineMetas.map((m) => m.id);

	let actLineEvents: ActLineEvent[] = [];
	let actLineEntries: ActLineEntry[] = [];
	let actLinePremises: ActLineEntry[] = [];
	let directorNotes: DirectorNote[] = [];

	if (actLineIds.length > 0) {
		actLineEvents = await getActLineEventsForLines(actLineIds);
		actLineEntries = await getActLineEntriesForLines(actLineIds);
		actLinePremises = await getActLinePremisesForLines(actLineIds);
		directorNotes = await getDirectorNotesForActLines(actLineIds);
	}

	const msgIdList = [...collectMessageIds(actLineEntries, actLinePremises, actLineEvents)];
	let messages: Message[] = [];

	if (msgIdList.length > 0) {
		messages = await getMessagesByIds(msgIdList);
	}

	const characterProfiles = actLineIds.length > 0 ? await getCharacterProfilesForActLines(actLineIds) : [];

	const exportData: StoryExportData = {
		version: CURRENT_ARCHIVE_VERSION,
		story: {
			id: story.id,
			name: story.name,
			locale: story.locale,
			createdAt: story.createdAt,
			updatedAt: story.updatedAt,
		},
		storyFolder: {
			storyId: storyFolder?.storyId ?? storyId,
			folderName: storyFolder?.folderName ?? '',
			createdAt: storyFolder?.createdAt ?? Date.now(),
		},
		acts: acts.map((a) => ({
			id: a.id,
			storyId: a.storyId,
			name: a.name,
			actNumber: a.actNumber,
			continuesFromActLineId: a.continuesFromActLineId,
			createdAt: a.createdAt,
			updatedAt: a.updatedAt,
		})),
		actLineMeta: actLineMetas.map((m) => ({
			id: m.id,
			actId: m.actId,
			name: m.name,
			isMainLine: m.isMainLine,
			createdAt: m.createdAt,
			plotMode: m.plotMode,
		})),
		actLineEvents: actLineEvents.map((e) => ({
			id: e.id,
			actLineId: e.actLineId,
			messageId: e.messageId,
			messageSequence: e.messageSequence,
			event: e.event,
			value: e.value,
			createdAt: e.createdAt,
		})),
		actLineEntries: actLineEntries.map((e) => ({
			actLineId: e.actLineId,
			messageId: e.messageId,
			sequence: e.sequence,
		})),
		actLinePremises: actLinePremises.map((p) => ({
			actLineId: p.actLineId,
			messageId: p.messageId,
			sequence: p.sequence,
		})),
		directorNotes: directorNotes.map((n) => ({
			id: n.id,
			actLineId: n.actLineId,
			text: n.text,
			isActive: n.isActive,
			effectiveFromScene: n.effectiveFromScene,
			effectiveToScene: n.effectiveToScene,
			createdAt: n.createdAt,
		})),
		messages: messages.map((m) => ({
			id: m.id,
			role: m.role,
			content: m.content,
			reasoning: m.reasoning ?? null,
			metadata: m.metadata ?? null,
			variables: m.variables ? JSON.stringify(m.variables) : null,
			actSummary: m.actSummary ?? null,
			scenePlot: m.scenePlot ?? null,
			importantPhrases: m.importantPhrases ?? null,
			sceneNumber: m.sceneNumber ?? null,
			createdAt: m.createdAt,
		})),
		characterProfiles: characterProfiles.map((p) => ({
			id: p.id,
			actLineId: p.actLineId,
			sceneNumber: p.sceneNumber,
			canonicalName: p.canonicalName,
			preferredName: p.preferredName,
			aliases: p.aliases,
			logline: p.logline,
			state: p.state,
			goal: p.goal,
			relationships: p.relationships,
			voice: p.voice,
			sceneDetails: p.sceneDetails,
			importance: p.importance,
			createdAt: p.createdAt,
			updatedAt: p.updatedAt,
		})),
	};

	const zip = new JSZip();
	zip.file('story-data.json', JSON.stringify(exportData, null, 2));

	const folderName = storyFolder?.folderName ?? '';
	if (folderName) {
		const folderExists = await fs.exists(folderName).catch(() => false);
		if (folderExists) {
			const files = await collectFilesInDir(folderName);
			for (const filePath of files) {
				const relativePath = filePath.slice(folderName.length + 1);
				const zipPath = `${folderName}/${relativePath}`;
				try {
					const data = await fs.readBinaryFile(filePath);
					if (isBinaryData(data)) {
						zip.file(zipPath, data);
					} else {
						const textContent = new TextDecoder().decode(data);
						zip.file(zipPath, textContent);
					}
				} catch (err) {
					console.warn(`Skipping file ${filePath} in export: ${err}`);
				}
			}
		}
	}

	const zipData = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
	const filename = `${folderName || `story-${story.id.slice(0, 8)}`}.zip`;
	await downloadExport(zipData, filename);
}
