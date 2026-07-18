import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import type { StoryExportData } from '$lib/features/story-export-load/archive-schema';
import { CURRENT_ARCHIVE_VERSION } from '$lib/features/story-export-load/archive-schema';
import { validateStoryData } from '$lib/features/story-export-load/archive-validator';

function makeValidExportData(): StoryExportData {
	return {
		version: CURRENT_ARCHIVE_VERSION,
		story: { id: 'story-1', name: 'Test Story', locale: 'en', createdAt: 1000, updatedAt: 2000 },
		storyFolder: { storyId: 'story-1', folderName: 'test-story', createdAt: 1000 },
		acts: [
			{ id: 'act-1', storyId: 'story-1', name: 'Act 1', actNumber: 1, continuesFromActLineId: null, createdAt: 1000, updatedAt: 2000 },
			{ id: 'act-2', storyId: 'story-1', name: 'Act 2', actNumber: 2, continuesFromActLineId: 'line-1', createdAt: 2000, updatedAt: 3000 },
		],
		actLineMeta: [
			{ id: 'line-1', actId: 'act-1', name: 'Main Line', isMainLine: true, createdAt: 1000, plotMode: 'guidance' },
			{ id: 'line-2', actId: 'act-2', name: 'Branch', isMainLine: false, createdAt: 2000, plotMode: 'phaseEvent' },
		],
		actLineEvents: [
			{ id: 'evt-1', actLineId: 'line-1', messageId: 'msg-1', messageSequence: 1, event: 'plot-generated', value: '1', createdAt: 1000 },
			{ id: 'evt-2', actLineId: 'line-2', messageId: 'msg-3', messageSequence: 1, event: 'ending', value: 'happy', createdAt: 2500 },
		],
		actLineEntries: [
			{ actLineId: 'line-1', messageId: 'msg-1', sequence: 1 },
			{ actLineId: 'line-1', messageId: 'msg-2', sequence: 2 },
			{ actLineId: 'line-2', messageId: 'msg-3', sequence: 1 },
		],
		actLinePremises: [{ actLineId: 'line-1', messageId: 'msg-0', sequence: 1 }],
		directorNotes: [
			{
				id: 'note-1',
				actLineId: 'line-1',
				text: 'Keep it funny',
				isActive: true,
				effectiveFromScene: 1,
				effectiveToScene: 5,
				createdAt: 1000,
			},
		],
		messages: [
			{
				id: 'msg-0',
				role: 'user',
				content: 'Premise',
				reasoning: null,
				metadata: null,
				variables: null,
				actSummary: null,
				scenePlot: null,
				importantPhrases: null,
				sceneNumber: null,
				createdAt: 500,
			},
			{
				id: 'msg-1',
				role: 'assistant',
				content: 'Response 1',
				reasoning: null,
				metadata: null,
				variables: null,
				actSummary: 'Summary',
				scenePlot: null,
				importantPhrases: null,
				sceneNumber: 1,
				createdAt: 1000,
			},
			{
				id: 'msg-2',
				role: 'user',
				content: 'User input',
				reasoning: null,
				metadata: null,
				variables: null,
				actSummary: null,
				scenePlot: null,
				importantPhrases: null,
				sceneNumber: 2,
				createdAt: 1500,
			},
			{
				id: 'msg-3',
				role: 'assistant',
				content: 'Response 2',
				reasoning: null,
				metadata: null,
				variables: null,
				actSummary: null,
				scenePlot: 'plot',
				importantPhrases: 'phrase1\nphrase2',
				sceneNumber: 1,
				createdAt: 2000,
			},
		],
		characterProfiles: [
			{
				id: 'cp-1',
				actLineId: 'line-1',
				sceneNumber: 1,
				canonicalName: 'elena',
				preferredName: 'Elena',
				aliases: ['El'],
				logline: 'A curious wanderer seeking truth',
				state: null,
				goal: 'find the truth',
				relationships: null,
				voice: 'soft',
				sceneDetails: 'wears a blue cloak',
				importance: 2,
				createdAt: 1100,
				updatedAt: 1100,
			},
		],
	};
}

async function makeZipWithData(data: StoryExportData): Promise<JSZip> {
	const zip = new JSZip();
	zip.file('story-data.json', JSON.stringify(data, null, 2));
	zip.file(`${data.storyFolder.folderName}/world.md`, '# World\nTest content');
	zip.file(`${data.storyFolder.folderName}/act-1/main-line/act-plot.md`, '# Act Plot');
	return zip;
}

describe('story-export-load integration helpers', () => {
	describe('makeValidExportData', () => {
		it('produces valid export data with all required fields', () => {
			const data = makeValidExportData();
			expect(data.version).toBe(CURRENT_ARCHIVE_VERSION);
			expect(data.story.id).toBeTruthy();
			expect(data.storyFolder.folderName).toBeTruthy();
			expect(data.acts.length).toBeGreaterThan(0);
			expect(data.actLineMeta.length).toBeGreaterThan(0);
			expect(data.messages.length).toBeGreaterThan(0);
			expect(data.characterProfiles?.length).toBeGreaterThan(0);

			const lineIds = new Set(data.actLineMeta.map((m) => m.id));
			for (const entry of data.actLineEntries) {
				expect(lineIds.has(entry.actLineId)).toBe(true);
			}
			for (const prem of data.actLinePremises) {
				expect(lineIds.has(prem.actLineId)).toBe(true);
			}
			for (const evt of data.actLineEvents) {
				expect(lineIds.has(evt.actLineId)).toBe(true);
			}
			for (const note of data.directorNotes) {
				expect(lineIds.has(note.actLineId)).toBe(true);
			}
			for (const cp of data.characterProfiles ?? []) {
				expect(lineIds.has(cp.actLineId)).toBe(true);
			}
		});

		it('has correct lineage chain: act-2 continues from line-1', () => {
			const data = makeValidExportData();
			const act2 = data.acts.find((a) => a.actNumber === 2)!;
			expect(act2.continuesFromActLineId).toBe('line-1');
		});

		it('all message IDs in entries are in messages array', () => {
			const data = makeValidExportData();
			const msgIds = new Set(data.messages.map((m) => m.id));
			for (const entry of data.actLineEntries) {
				expect(msgIds.has(entry.messageId)).toBe(true);
			}
			for (const prem of data.actLinePremises) {
				expect(msgIds.has(prem.messageId)).toBe(true);
			}
		});

		it('all act IDs in actLineMeta reference valid acts', () => {
			const data = makeValidExportData();
			const actIds = new Set(data.acts.map((a) => a.id));
			for (const meta of data.actLineMeta) {
				expect(actIds.has(meta.actId)).toBe(true);
			}
		});

		it('all storyId references in acts match story ID', () => {
			const data = makeValidExportData();
			for (const act of data.acts) {
				expect(act.storyId).toBe(data.story.id);
			}
		});
	});

	describe('makeZipWithData', () => {
		it('creates a zip with story-data.json and folder content', async () => {
			const data = makeValidExportData();
			const zip = await makeZipWithData(data);

			const storyDataFile = zip.file('story-data.json');
			expect(storyDataFile).not.toBeNull();

			const content = await storyDataFile!.async('string');
			const parsed = JSON.parse(content);
			expect(parsed.version).toBe(CURRENT_ARCHIVE_VERSION);
			expect(parsed.story.name).toBe('Test Story');
			expect(parsed.characterProfiles.length).toBeGreaterThan(0);

			const worldFile = zip.file(`${data.storyFolder.folderName}/world.md`);
			expect(worldFile).not.toBeNull();
		});
	});

	describe('backward compatibility', () => {
		it('validates legacy v1 archive (no characterProfiles field)', () => {
			const data = makeValidExportData() as unknown as Record<string, unknown>;
			data.version = 1;
			delete data.characterProfiles;

			const result = validateStoryData(data);
			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it('rejects unknown future version', () => {
			const data = makeValidExportData() as unknown as Record<string, unknown>;
			data.version = CURRENT_ARCHIVE_VERSION + 1;

			const result = validateStoryData(data);
			expect(result.isValid).toBe(false);
			expect(result.errors[0]).toMatch(/version/i);
		});

		it('rejects archive with missing version', () => {
			const data = makeValidExportData() as unknown as Record<string, unknown>;
			delete data.version;

			const result = validateStoryData(data);
			expect(result.isValid).toBe(false);
			expect(result.errors[0]).toMatch(/version/i);
		});

		it('rejects archive with non-number version', () => {
			const data = makeValidExportData() as unknown as Record<string, unknown>;
			data.version = '1.1.1';

			const result = validateStoryData(data);
			expect(result.isValid).toBe(false);
			expect(result.errors[0]).toMatch(/version/i);
		});
	});
});
