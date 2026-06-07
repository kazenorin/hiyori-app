import { describe, it, expect, vi } from 'vitest';
import { regenerateIds } from '$lib/features/story-export-load/id-remapper';
import type { StoryExportData } from '$lib/features/story-export-load/archive-schema';

function makeValidData(): StoryExportData {
	return {
		version: 1,
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
				text: 'Note text',
				isActive: true,
				effectiveFromScene: null,
				effectiveToScene: null,
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
				actSummary: null,
				scenePlot: null,
				importantPhrases: null,
				sceneNumber: 1,
				createdAt: 1000,
			},
			{
				id: 'msg-2',
				role: 'user',
				content: 'User 2',
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
				content: 'Response 3',
				reasoning: null,
				metadata: null,
				variables: null,
				actSummary: null,
				scenePlot: null,
				importantPhrases: null,
				sceneNumber: 1,
				createdAt: 2000,
			},
		],
	};
}

describe('regenerateIds', () => {
	it('generates a new story ID', () => {
		const data = makeValidData();
		const result = regenerateIds(data);
		expect(result.newStoryId).not.toBe('story-1');
		expect(result.data.story.id).toBe(result.newStoryId);
	});

	it('maps old story ID to new story ID', () => {
		const data = makeValidData();
		const result = regenerateIds(data);
		expect(result.idMap.get('story-1')).toBe(result.newStoryId);
	});

	it('generates new folder name with last 8 chars of new story ID', () => {
		const data = makeValidData();
		const result = regenerateIds(data);
		expect(result.newFolderName).toBe(`Story-${result.newStoryId.slice(-8)}`);
		expect(result.data.storyFolder.folderName).toBe(result.newFolderName);
	});

	it('updates storyFolder.storyId to new story ID', () => {
		const data = makeValidData();
		const result = regenerateIds(data);
		expect(result.data.storyFolder.storyId).toBe(result.newStoryId);
	});

	it('remaps all act IDs and storyId references', () => {
		const data = makeValidData();
		const result = regenerateIds(data);

		for (const act of result.data.acts) {
			expect(act.id).not.toBe('act-1');
			expect(act.id).not.toBe('act-2');
			expect(act.storyId).toBe(result.newStoryId);
		}

		const origActIds = data.acts.map((a) => a.id);
		for (const origId of origActIds) {
			expect(result.idMap.has(origId)).toBe(true);
		}
	});

	it('remaps continuesFromActLineId to new act line ID', () => {
		const data = makeValidData();
		const result = regenerateIds(data);

		const act2 = result.data.acts.find((a) => a.actNumber === 2)!;
		const newLine1Id = result.idMap.get('line-1')!;
		expect(act2.continuesFromActLineId).toBe(newLine1Id);
	});

	it('remaps act line meta IDs and actId references', () => {
		const data = makeValidData();
		const result = regenerateIds(data);

		for (const meta of result.data.actLineMeta) {
			expect(meta.id).not.toBe('line-1');
			expect(meta.id).not.toBe('line-2');
			const newActIds = result.data.acts.map((a) => a.id);
			expect(newActIds).toContain(meta.actId);
		}
	});

	it('remaps act line event IDs and references', () => {
		const data = makeValidData();
		const result = regenerateIds(data);

		for (const evt of result.data.actLineEvents) {
			expect(evt.id).not.toBe('evt-1');
			const newLineIds = result.data.actLineMeta.map((m) => m.id);
			expect(newLineIds).toContain(evt.actLineId);
			if (evt.messageId) {
				const newMessageIds = result.data.messages.map((m) => m.id);
				expect(newMessageIds).toContain(evt.messageId);
			}
		}
	});

	it('remaps act line entries (junction table) references', () => {
		const data = makeValidData();
		const result = regenerateIds(data);

		for (const entry of result.data.actLineEntries) {
			const newLineIds = result.data.actLineMeta.map((m) => m.id);
			expect(newLineIds).toContain(entry.actLineId);
			const newMessageIds = result.data.messages.map((m) => m.id);
			expect(newMessageIds).toContain(entry.messageId);
		}
	});

	it('remaps act line premises (junction table) references', () => {
		const data = makeValidData();
		const result = regenerateIds(data);

		for (const prem of result.data.actLinePremises) {
			const newLineIds = result.data.actLineMeta.map((m) => m.id);
			expect(newLineIds).toContain(prem.actLineId);
			const newMessageIds = result.data.messages.map((m) => m.id);
			expect(newMessageIds).toContain(prem.messageId);
		}
	});

	it('remaps director notes IDs and actLineId references', () => {
		const data = makeValidData();
		const result = regenerateIds(data);

		for (const note of result.data.directorNotes) {
			expect(note.id).not.toBe('note-1');
			const newLineIds = result.data.actLineMeta.map((m) => m.id);
			expect(newLineIds).toContain(note.actLineId);
		}
	});

	it('remaps message IDs', () => {
		const data = makeValidData();
		const result = regenerateIds(data);

		for (const msg of result.data.messages) {
			expect(msg.id).not.toBe('msg-0');
			expect(msg.id).not.toBe('msg-1');
			expect(msg.id).not.toBe('msg-2');
			expect(msg.id).not.toBe('msg-3');
		}
		expect(result.data.messages).toHaveLength(data.messages.length);
	});

	it('preserves non-ID fields unchanged', () => {
		const data = makeValidData();
		const result = regenerateIds(data);

		expect(result.data.story.name).toBe('Test Story');
		expect(result.data.story.locale).toBe('en');
		expect(result.data.acts[0].name).toBe('Act 1');
		expect(result.data.acts[0].actNumber).toBe(1);
		expect(result.data.actLineMeta[0].name).toBe('Main Line');
		expect(result.data.actLineMeta[0].plotMode).toBe('guidance');
		expect(result.data.messages[0].content).toBe('Premise');
	});

	it('handles null continuesFromActLineId', () => {
		const data = makeValidData();
		const result = regenerateIds(data);

		const act1 = result.data.acts.find((a) => a.actNumber === 1)!;
		expect(act1.continuesFromActLineId).toBeNull();
	});

	it('handles null messageId in events', () => {
		const data = makeValidData();
		data.actLineEvents[0].messageId = null;
		const result = regenerateIds(data);
		expect(result.data.actLineEvents[0].messageId).toBeNull();
	});

	it('handles null fields in messages', () => {
		const data = makeValidData();
		data.messages[0].reasoning = null;
		data.messages[0].sceneNumber = null;
		const result = regenerateIds(data);
		expect(result.data.messages[0].reasoning).toBeNull();
		expect(result.data.messages[0].sceneNumber).toBeNull();
	});

	it('idMap contains all remapped IDs', () => {
		const data = makeValidData();
		const result = regenerateIds(data);

		const expectedIdCount =
			1 + // story
			data.acts.length +
			data.actLineMeta.length +
			data.messages.length +
			data.actLineEvents.length +
			data.directorNotes.length;

		expect(result.idMap.size).toBe(expectedIdCount);
	});

	it('all generated IDs are unique', () => {
		const data = makeValidData();
		const result = regenerateIds(data);

		const allNewIds = new Set<string>();
		for (const [, newId] of result.idMap) {
			expect(allNewIds.has(newId)).toBe(false);
			allNewIds.add(newId);
		}
	});

	it('original data is not mutated', () => {
		const data = makeValidData();
		const origStoryId = data.story.id;
		const origActId = data.acts[0].id;
		regenerateIds(data);
		expect(data.story.id).toBe(origStoryId);
		expect(data.acts[0].id).toBe(origActId);
	});
});
