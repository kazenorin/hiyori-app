import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MemoryItem } from '$lib/memory/memory';

// Mock the database module for act-lines batchResolveActLineInfo
const mockDb = {
	execute: vi.fn(async () => ({ rows: [] })),
	select: vi.fn(async () => []),
};

vi.mock('$lib/db/database', () => ({
	getDatabase: () => mockDb,
}));

// Mock the memory database
vi.mock('$lib/db/memory-database', () => ({
	getMemoryDatabase: () => ({
		execute: vi.fn(async () => ({ rows: [] })),
		select: vi.fn(async () => []),
	}),
}));

// Mock AI SDK
vi.mock('ai', () => ({
	embed: vi.fn(async () => ({ embedding: [0.1, 0.2] })),
	embedMany: vi.fn(async () => ({ embeddings: [[0.1, 0.2]] })),
	tool: vi.fn((def) => def),
}));

vi.mock('$lib/ai/provider', () => ({
	createEmbeddingModel: vi.fn(() => ({})),
}));

const mockSearchResults: MemoryItem[] = [
	{
		id: 'mem-1',
		memory: 'Elena fought the dragon.',
		messageId: 'msg-5',
		storyId: 'story-1',
		actLineId: 'line-1',
		characterCanonicalName: 'elena',
		location: 'cave',
	},
	{
		id: 'mem-2',
		memory: 'Marcus healed Elena.',
		messageId: 'msg-8',
		storyId: 'story-1',
		actLineId: 'line-1',
		characterCanonicalName: 'marcus',
		location: 'tavern',
	},
];

describe('createQueryMemoriesTool', () => {
	let createQueryMemoriesTool: typeof import('$lib/ai/tools/query-memories').createQueryMemoriesTool;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();

		vi.doMock('$lib/db/database', () => ({ getDatabase: () => mockDb }));
		vi.doMock('$lib/db/memory-database', () => ({
			getMemoryDatabase: () => ({
				execute: vi.fn(async () => ({ rows: [] })),
				select: vi.fn(async () => []),
			}),
		}));
		vi.doMock('ai', () => ({
			embed: vi.fn(async () => ({ embedding: [0.1, 0.2] })),
			embedMany: vi.fn(async () => ({ embeddings: [[0.1, 0.2]] })),
			tool: vi.fn((def) => def),
		}));
		vi.doMock('$lib/ai/provider', () => ({
			createEmbeddingModel: vi.fn(() => ({})),
		}));

		const mod = await import('$lib/ai/tools/query-memories');
		createQueryMemoriesTool = mod.createQueryMemoriesTool;
	});

	it('returns empty array when no parameters provided', async () => {
		const searchSpy = vi.fn(async () => mockSearchResults);
		const searchByLocSpy = vi.fn(async () => mockSearchResults);
		const mem = { search: searchSpy, searchByLocation: searchByLocSpy } as any;

		const toolDef = createQueryMemoriesTool({
			memory: mem,
			storyId: 'story-1',
			actLineId: 'line-1',
		});

		const result = await toolDef.execute!(
			{
				characterQuery: undefined,
				timeAndLocation: undefined,
				currentActOnly: true,
			},
			{ toolCallId: 'test', messages: [] }
		);

		expect(result).toEqual([]);
		expect(searchSpy).not.toHaveBeenCalled();
		expect(searchByLocSpy).not.toHaveBeenCalled();
	});

	it('calls search when only characterQuery provided', async () => {
		const searchSpy = vi.fn(async () => mockSearchResults);
		const mem = { search: searchSpy, searchByLocation: vi.fn(async () => []) } as any;

		const toolDef = createQueryMemoriesTool({
			memory: mem,
			storyId: 'story-1',
			actLineId: 'line-1',
		});

		await toolDef.execute!(
			{
				characterQuery: 'Elena',
				timeAndLocation: undefined,
				currentActOnly: true,
			},
			{ toolCallId: 'test', messages: [] }
		);

		expect(searchSpy).toHaveBeenCalledWith('Elena', {
			storyId: 'story-1',
			actLineId: 'line-1',
			limit: 10,
		});
	});

	it('calls search when only timeAndLocation provided', async () => {
		const searchSpy = vi.fn(async () => mockSearchResults);
		const mem = { search: searchSpy, searchByLocation: vi.fn(async () => []) } as any;

		const toolDef = createQueryMemoriesTool({
			memory: mem,
			storyId: 'story-1',
			actLineId: 'line-1',
		});

		await toolDef.execute!(
			{
				characterQuery: undefined,
				timeAndLocation: 'Night at the Tavern',
				currentActOnly: true,
			},
			{ toolCallId: 'test', messages: [] }
		);

		expect(searchSpy).toHaveBeenCalledWith('Night at the Tavern', {
			storyId: 'story-1',
			actLineId: 'line-1',
			limit: 10,
		});
	});

	it('calls searchByLocation with both params when both provided', async () => {
		const searchByLocSpy = vi.fn(async () => mockSearchResults);
		const mem = { search: vi.fn(async () => []), searchByLocation: searchByLocSpy } as any;

		const toolDef = createQueryMemoriesTool({
			memory: mem,
			storyId: 'story-1',
			actLineId: 'line-1',
		});

		await toolDef.execute!(
			{
				characterQuery: 'Elena',
				timeAndLocation: 'Cave',
				currentActOnly: false,
			},
			{ toolCallId: 'test', messages: [] }
		);

		expect(searchByLocSpy).toHaveBeenCalledWith('Elena', 'Cave', {
			storyId: 'story-1',
			actLineId: undefined,
			limit: 10,
		});
	});
});
