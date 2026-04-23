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

const noOpResolveAliases = vi.fn(async (_s: any, _a: any, name: string) => [name]);

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
		const mem = { resolveAliases: noOpResolveAliases, search: searchSpy, searchByLocation: searchByLocSpy } as any;

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
		const mem = { resolveAliases: noOpResolveAliases, search: searchSpy, searchByLocation: vi.fn(async () => []) } as any;

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

	it('calls searchLocations + sampleByLocation when only timeAndLocation provided', async () => {
		const locationItems = [
			{ id: 'loc-1', location: 'Tavern', messageId: 'msg-1', storyId: 'story-1', actLineId: 'line-1' },
			{ id: 'loc-2', location: 'Inn', messageId: 'msg-2', storyId: 'story-1', actLineId: 'line-1' },
		];
		const searchLocationsSpy = vi.fn(async () => locationItems);
		const sampleByLocationSpy = vi.fn(async () => mockSearchResults);
		const mem = {
			resolveAliases: noOpResolveAliases,
			search: vi.fn(async () => []),
			searchByLocation: vi.fn(async () => []),
			searchLocations: searchLocationsSpy,
			sampleByLocation: sampleByLocationSpy,
		} as any;

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

		expect(searchLocationsSpy).toHaveBeenCalledWith('Night at the Tavern', {
			storyId: 'story-1',
			actLineId: 'line-1',
			limit: 10,
		});
		expect(sampleByLocationSpy).toHaveBeenCalledTimes(2);
		expect(sampleByLocationSpy).toHaveBeenCalledWith(locationItems[0], 10);
		expect(sampleByLocationSpy).toHaveBeenCalledWith(locationItems[1], 10);
	});

	it('calls searchByLocation with both params when both provided', async () => {
		const searchByLocSpy = vi.fn(async () => mockSearchResults);
		const mem = { resolveAliases: noOpResolveAliases, search: vi.fn(async () => []), searchByLocation: searchByLocSpy } as any;

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

	it('slices results to limit for sorted search results', async () => {
		// search returns sorted by relevance - should slice top 10
		const manyResults = Array.from({ length: 20 }, (_v, i) => ({
			id: `mem-${i}`,
			memory: `Memory ${i}`,
			messageId: `msg-${i}`,
			storyId: 'story-1',
			actLineId: 'line-1',
			characterCanonicalName: 'elena',
			location: 'cave',
		}));
		const searchSpy = vi.fn(async () => manyResults);
		const mem = { resolveAliases: noOpResolveAliases, search: searchSpy, searchByLocation: vi.fn(async () => []) } as any;

		const toolDef = createQueryMemoriesTool({
			memory: mem,
			storyId: 'story-1',
			actLineId: 'line-1',
		});

		const result = await toolDef.execute!(
			{
				characterQuery: 'Elena',
				timeAndLocation: undefined,
				currentActOnly: true,
			},
			{ toolCallId: 'test', messages: [] }
		);

		// Should return exactly 10 (slice, not random sample)
		expect((result as any).length).toBe(10);
		// Should be first 10 items (sorted order preserved)
		expect((result as any).map((r: any) => r.memory)).toEqual(manyResults.slice(0, 10).map((m) => m.memory));
	});

	it('returns all results when fewer than limit', async () => {
		const fewResults = mockSearchResults; // 2 items
		const searchSpy = vi.fn(async () => fewResults);
		const mem = { resolveAliases: noOpResolveAliases, search: searchSpy, searchByLocation: vi.fn(async () => []) } as any;

		const toolDef = createQueryMemoriesTool({
			memory: mem,
			storyId: 'story-1',
			actLineId: 'line-1',
		});

		const result = await toolDef.execute!(
			{
				characterQuery: 'Elena',
				timeAndLocation: undefined,
				currentActOnly: true,
			},
			{ toolCallId: 'test', messages: [] }
		);

		expect((result as any).length).toBe(2);
	});
	it('samples randomly for timeAndLocation-only case', async () => {
		const locationItems = [
			{ id: 'loc-1', location: 'Tavern', messageId: 'msg-loc-1', storyId: 'story-1', actLineId: 'line-1' },
			{ id: 'loc-2', location: 'Cave', messageId: 'msg-loc-2', storyId: 'story-1', actLineId: 'line-1' },
		];
		// Each location returns 8 items, total 16
		const tavernMemories = Array.from({ length: 8 }, (_v, i) => ({
			id: `mem-tavern-${i}`,
			memory: `Tavern memory ${i}`,
			messageId: `msg-t-${i}`,
			storyId: 'story-1',
			actLineId: 'line-1',
			characterCanonicalName: 'npc',
			location: 'Tavern',
		}));
		const caveMemories = Array.from({ length: 8 }, (_v, i) => ({
			id: `mem-cave-${i}`,
			memory: `Cave memory ${i}`,
			messageId: `msg-c-${i}`,
			storyId: 'story-1',
			actLineId: 'line-1',
			characterCanonicalName: 'elena',
			location: 'Cave',
		}));
		const searchLocationsSpy = vi.fn(async () => locationItems);
		const sampleByLocationSpy = vi.fn(async (loc: any) => (loc.location === 'Tavern' ? tavernMemories : caveMemories));
		const mem = {
			resolveAliases: noOpResolveAliases,
			search: vi.fn(async () => []),
			searchByLocation: vi.fn(async () => []),
			searchLocations: searchLocationsSpy,
			sampleByLocation: sampleByLocationSpy,
		} as any;

		const toolDef = createQueryMemoriesTool({
			memory: mem,
			storyId: 'story-1',
			actLineId: 'line-1',
		});

		const result = await toolDef.execute!(
			{
				characterQuery: undefined,
				timeAndLocation: 'Night at the Tavern',
				currentActOnly: true,
			},
			{ toolCallId: 'test', messages: [] }
		);

		// Should return exactly 10 (sampleSize from 16 total)
		expect((result as any).length).toBe(10);
		// All results should come from the original pool
		const allMemories = [...tavernMemories, ...caveMemories];
		for (const r of result as any) {
			expect(allMemories.some((m) => m.memory === r.memory)).toBe(true);
		}
	});
});
