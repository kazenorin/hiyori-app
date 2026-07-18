import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { validateArchive } from '$lib/features/story-export-load/archive-validator';
import { CURRENT_ARCHIVE_VERSION, type StoryExportData } from '$lib/features/story-export-load/archive-schema';

function makeValidData(): StoryExportData {
	return {
		version: 1,
		story: { id: 'story-1', name: 'Test Story', locale: 'en', createdAt: 1000, updatedAt: 2000 },
		storyFolder: { storyId: 'story-1', folderName: 'test-story', createdAt: 1000 },
		acts: [
			{ id: 'act-1', storyId: 'story-1', name: 'Act 1', actNumber: 1, continuesFromActLineId: null, createdAt: 1000, updatedAt: 2000 },
		],
		actLineMeta: [{ id: 'line-1', actId: 'act-1', name: 'Main Line', isMainLine: true, createdAt: 1000, plotMode: 'guidance' }],
		actLineEvents: [],
		actLineEntries: [],
		actLinePremises: [],
		directorNotes: [],
		messages: [
			{
				id: 'msg-1',
				role: 'user',
				content: 'Hello',
				reasoning: null,
				metadata: null,
				variables: null,
				actSummary: null,
				scenePlot: null,
				importantPhrases: null,
				sceneNumber: 1,
				createdAt: 1000,
			},
		],
	};
}

async function makeValidZip(data?: StoryExportData, includeFolder = true): Promise<JSZip> {
	const zip = new JSZip();
	const exportData = data ?? makeValidData();
	zip.file('story-data.json', JSON.stringify(exportData, null, 2));
	if (includeFolder) {
		zip.file(`${exportData.storyFolder.folderName}/world.md`, '# World\n\nTest content');
	}
	return zip;
}

describe('validateArchive', () => {
	it('accepts a valid archive with story folder', async () => {
		const zip = await makeValidZip();
		const result = await validateArchive(zip);
		expect(result.isValid).toBe(true);
		expect(result.errors).toHaveLength(0);
		expect(result.data).toBeDefined();
		expect(result.data!.story.name).toBe('Test Story');
	});

	it('accepts a valid archive without story folder (warns)', async () => {
		const zip = await makeValidZip(undefined, false);
		const result = await validateArchive(zip);
		expect(result.isValid).toBe(true);
		expect(result.warnings.length).toBeGreaterThanOrEqual(1);
		expect(result.warnings[0]).toContain('Story folder not found');
	});

	it('rejects archive missing story-data.json', async () => {
		const zip = new JSZip();
		const result = await validateArchive(zip);
		expect(result.isValid).toBe(false);
		expect(result.errors).toContain('story-data.json not found in archive root');
	});

	it('rejects archive with invalid JSON in story-data.json', async () => {
		const zip = new JSZip();
		zip.file('story-data.json', 'not valid json {{{');
		const result = await validateArchive(zip);
		expect(result.isValid).toBe(false);
		expect(result.errors).toContain('story-data.json is not valid JSON');
	});

	it('rejects archive with wrong version', async () => {
		const data = makeValidData();
		(data as any).version = CURRENT_ARCHIVE_VERSION + 1;
		const zip = await makeValidZip(data);
		const result = await validateArchive(zip);
		expect(result.isValid).toBe(false);
		expect(result.errors[0]).toContain('Unsupported archive version');
	});

	it('rejects archive with missing story field', async () => {
		const data = makeValidData();
		delete (data as any).story;
		const zip = await makeValidZip(data);
		const result = await validateArchive(zip);
		expect(result.isValid).toBe(false);
		expect(result.errors).toContain('Missing or invalid "story" field');
	});

	it('rejects archive with missing storyFolder field', async () => {
		const data = makeValidData();
		const folderName = data.storyFolder.folderName;
		delete (data as any).storyFolder;
		const zip = new JSZip();
		zip.file('story-data.json', JSON.stringify(data, null, 2));
		zip.file(`${folderName}/world.md`, '# World');
		const result = await validateArchive(zip);
		expect(result.isValid).toBe(false);
		expect(result.errors).toContain('Missing or invalid "storyFolder" field');
	});

	it('rejects archive with missing messages array', async () => {
		const data = makeValidData();
		delete (data as any).messages;
		const zip = await makeValidZip(data);
		const result = await validateArchive(zip);
		expect(result.isValid).toBe(false);
		expect(result.errors).toContain('Missing or invalid "messages" field (expected array)');
	});

	it('returns parsed data on success', async () => {
		const data = makeValidData();
		const zip = await makeValidZip(data);
		const result = await validateArchive(zip);
		expect(result.data).toBeDefined();
		expect(result.data!.version).toBe(1);
		expect(result.data!.story.id).toBe('story-1');
		expect(result.data!.acts).toHaveLength(1);
		expect(result.data!.actLineMeta).toHaveLength(1);
		expect(result.data!.messages).toHaveLength(1);
	});
});
