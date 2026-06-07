import { describe, it, expect } from 'vitest';
import { validateStoryData } from '$lib/features/story-export-load/archive-validator';
import type { StoryExportData } from '$lib/features/story-export-load/archive-schema';

function makeValidData(): StoryExportData {
	return {
		version: 1,
		story: { id: 'story-1', name: 'Test Story', locale: 'en', createdAt: 1000, updatedAt: 2000 },
		storyFolder: { storyId: 'story-1', folderName: 'test-story', createdAt: 1000 },
		acts: [
			{ id: 'act-1', storyId: 'story-1', name: 'Act 1', actNumber: 1, continuesFromActLineId: null, createdAt: 1000, updatedAt: 2000 },
		],
		actLineMeta: [{ id: 'line-1', actId: 'act-1', name: 'Main Line', isMainLine: true, createdAt: 1000, plotMode: 'guidance' }],
		actLineEvents: [
			{ id: 'evt-1', actLineId: 'line-1', messageId: 'msg-1', messageSequence: 1, event: 'plot-generated', value: '1', createdAt: 1000 },
		],
		actLineEntries: [{ actLineId: 'line-1', messageId: 'msg-1', sequence: 1 }],
		actLinePremises: [{ actLineId: 'line-1', messageId: 'msg-0', sequence: 1 }],
		directorNotes: [
			{
				id: 'note-1',
				actLineId: 'line-1',
				text: 'A note',
				isActive: true,
				effectiveFromScene: null,
				effectiveToScene: null,
				createdAt: 1000,
			},
		],
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

describe('validateStoryData', () => {
	it('returns valid for correct data', () => {
		const result = validateStoryData(makeValidData());
		expect(result.isValid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it('rejects null input', () => {
		const result = validateStoryData(null);
		expect(result.isValid).toBe(false);
		expect(result.errors).toContain('story-data.json is not a valid JSON object');
	});

	it('rejects non-object input', () => {
		const result = validateStoryData('string');
		expect(result.isValid).toBe(false);
		expect(result.errors).toContain('story-data.json is not a valid JSON object');
	});

	it('rejects wrong version', () => {
		const data = makeValidData();
		(data as any).version = 2;
		const result = validateStoryData(data);
		expect(result.isValid).toBe(false);
		expect(result.errors[0]).toContain('Unsupported archive version');
	});

	it('rejects missing version', () => {
		const data = makeValidData();
		delete (data as any).version;
		const result = validateStoryData(data);
		expect(result.isValid).toBe(false);
		expect(result.errors[0]).toContain('Unsupported archive version');
	});

	it('reports missing story field', () => {
		const data = makeValidData();
		delete (data as any).story;
		const result = validateStoryData(data);
		expect(result.isValid).toBe(false);
		expect(result.errors).toContain('Missing or invalid "story" field');
	});

	it('reports missing storyFolder field', () => {
		const data = makeValidData();
		delete (data as any).storyFolder;
		const result = validateStoryData(data);
		expect(result.isValid).toBe(false);
		expect(result.errors).toContain('Missing or invalid "storyFolder" field');
	});

	it('reports missing acts array', () => {
		const data = makeValidData();
		(data as any).acts = 'not-array';
		const result = validateStoryData(data);
		expect(result.isValid).toBe(false);
		expect(result.errors).toContain('Missing or invalid "acts" field (expected array)');
	});

	it('reports missing actLineMeta array', () => {
		const data = makeValidData();
		(data as any).actLineMeta = null;
		const result = validateStoryData(data);
		expect(result.isValid).toBe(false);
		expect(result.errors).toContain('Missing or invalid "actLineMeta" field (expected array)');
	});

	it('reports missing messages array', () => {
		const data = makeValidData();
		(data as any).messages = 42;
		const result = validateStoryData(data);
		expect(result.isValid).toBe(false);
		expect(result.errors).toContain('Missing or invalid "messages" field (expected array)');
	});

	it('reports missing story.id', () => {
		const data = makeValidData();
		data.story.id = '';
		const result = validateStoryData(data);
		expect(result.isValid).toBe(false);
		expect(result.errors).toContain('story.id is missing or not a string');
	});

	it('reports missing story.name', () => {
		const data = makeValidData();
		(data.story as any).name = 123;
		const result = validateStoryData(data);
		expect(result.isValid).toBe(false);
		expect(result.errors).toContain('story.name is missing or not a string');
	});

	it('reports missing storyFolder.folderName', () => {
		const data = makeValidData();
		data.storyFolder.folderName = '';
		const result = validateStoryData(data);
		expect(result.isValid).toBe(false);
		expect(result.errors).toContain('storyFolder.folderName is missing or not a string');
	});

	it('warns for empty act lines', () => {
		const data = makeValidData();
		data.actLineMeta = [];
		const result = validateStoryData(data);
		expect(result.isValid).toBe(true);
		expect(result.warnings).toContain('Archive contains no act lines');
	});

	it('accepts data with empty optional arrays', () => {
		const data = makeValidData();
		data.actLineEvents = [];
		data.actLineEntries = [];
		data.actLinePremises = [];
		data.directorNotes = [];
		data.messages = [];
		const result = validateStoryData(data);
		expect(result.isValid).toBe(true);
	});

	it('accumulates multiple errors', () => {
		const result = validateStoryData({ version: 1 });
		expect(result.isValid).toBe(false);
		expect(result.errors.length).toBeGreaterThanOrEqual(3);
	});
});
