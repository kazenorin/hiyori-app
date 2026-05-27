import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(async () => {}),
}));

vi.mock('$lib/logging/logger', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {}),
	},
	fileLog: vi.fn(async () => {}),
}));

const mockTraceActLineChain = vi.fn(async (actLineId: string) => [
	{ actLineId: 'line-1', actNumber: 1 },
	{ actLineId, actNumber: 2 },
]);

vi.mock('$lib/db/act-lines', () => ({
	traceActLineChain: (actLineId: string) => mockTraceActLineChain(actLineId),
}));

import { createQueryInventoryTool } from '$lib/ai/tools/query-inventory';
import type { Memory } from '$lib/features/memory';
import type { InventoryItem, InventoryChange } from '$lib/features/memory/inventory-types';

interface InventoryResult {
	name: string;
	category: string;
	equipStatus: string;
	description: string | null;
}

interface InventoryChangeResult {
	itemName: string;
	changeType: string;
	description: string | null;
}

interface QueryInventoryOutput {
	inventory: InventoryResult[];
	changes?: InventoryChangeResult[];
}

function createMockMemory(items: InventoryItem[], changes: InventoryChange[] = []): Partial<Memory> {
	return {
		resolveAliases: vi.fn(async (_storyId: string, _actLineIds: string[], name: string) => [name]),
		getInventory: vi.fn(async (characterName: string, _options: unknown) =>
			items.filter((item) => item.characterCanonicalName === characterName)
		),
		getInventoryChanges: vi.fn(async (characterName: string, _options: unknown) =>
			changes.filter((c) => c.characterCanonicalName === characterName)
		),
	};
}

const sampleItems: InventoryItem[] = [
	{
		id: '1',
		storyId: 'story-1',
		actLineId: 'line-1',
		characterCanonicalName: 'elena',
		itemName: 'Iron Sword',
		category: 'item',
		equipStatus: 'carried',
		description: 'A battered blade',
		messageId: 'msg-1',
		createdAt: null,
	},
	{
		id: '2',
		storyId: 'story-1',
		actLineId: 'line-1',
		characterCanonicalName: 'elena',
		itemName: 'Leather Armor',
		category: 'equipment',
		equipStatus: 'equipped',
		description: null,
		messageId: 'msg-1',
		createdAt: null,
	},
];

describe('createQueryInventoryTool', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns inventory items for a character', async () => {
		const mockMemory = createMockMemory(sampleItems);
		const tool = createQueryInventoryTool({
			memory: mockMemory as Memory,
			storyId: 'story-1',
			actLineId: 'line-2',
		actNumber: 2,
		});

		const result = (await tool.execute!(
			{ characterName: 'elena' },
			{ toolCallId: 'test', messages: [], abortSignal: undefined }
		)) as unknown as QueryInventoryOutput;
		expect(result.inventory).toHaveLength(2);
		expect(result.inventory[0].name).toBe('Iron Sword');
		expect(result.inventory[0].category).toBe('item');
		expect(result.inventory[0].equipStatus).toBe('carried');
		expect(result.inventory[0].description).toBe('A battered blade');
		expect(result.inventory[1].name).toBe('Leather Armor');
		expect(result.inventory[1].equipStatus).toBe('equipped');
	});

	it('resolves aliases and combines results', async () => {
		const items: InventoryItem[] = [
			{
				id: '1',
				storyId: 'story-1',
				actLineId: 'line-1',
				characterCanonicalName: 'elena-shadowcrest',
				itemName: 'Iron Sword',
				category: 'item',
				equipStatus: 'carried',
				description: null,
				messageId: 'msg-1',
				createdAt: null,
			},
			{
				id: '2',
				storyId: 'story-1',
				actLineId: 'line-1',
				characterCanonicalName: 'Elena',
				itemName: 'Healing Potion',
				category: 'item',
				equipStatus: 'carried',
				description: null,
				messageId: 'msg-2',
				createdAt: null,
			},
		];
		const mockMemory = createMockMemory(items);
		mockMemory.resolveAliases = vi.fn(async () => ['elena-shadowcrest', 'Elena']);

		const tool = createQueryInventoryTool({
			memory: mockMemory as Memory,
			storyId: 'story-1',
			actLineId: 'line-2',
		actNumber: 2,
		});

		const result = (await tool.execute!(
			{ characterName: 'Elena' },
			{ toolCallId: 'test', messages: [], abortSignal: undefined }
		)) as unknown as QueryInventoryOutput;
		expect(result.inventory).toHaveLength(2);
		expect(result.inventory[0].name).toBe('Iron Sword');
		expect(result.inventory[1].name).toBe('Healing Potion');
	});

	it('returns empty inventory when no items found', async () => {
		const mockMemory = createMockMemory([]);
		const tool = createQueryInventoryTool({
			memory: mockMemory as Memory,
			storyId: 'story-1',
			actLineId: 'line-2',
		actNumber: 2,
		});

		const result = (await tool.execute!(
			{ characterName: 'unknown' },
			{ toolCallId: 'test', messages: [], abortSignal: undefined }
		)) as unknown as QueryInventoryOutput;
		expect(result.inventory).toHaveLength(0);
	});

	it('filters by category when provided', async () => {
		const mockMemory = createMockMemory([]);
		const tool = createQueryInventoryTool({
			memory: mockMemory as Memory,
			storyId: 'story-1',
			actLineId: 'line-2',
		actNumber: 2,
		});

		await tool.execute!({ characterName: 'elena', itemCategory: 'skill' }, { toolCallId: 'test', messages: [], abortSignal: undefined });
		expect(mockMemory.getInventory).toHaveBeenCalledWith('elena', {
			storyId: 'story-1',
			actLineIds: ['line-1', 'line-2'],
			category: 'skill',
		});
	});

	it('does not pass category filter when omitted', async () => {
		const mockMemory = createMockMemory([]);
		const tool = createQueryInventoryTool({
			memory: mockMemory as Memory,
			storyId: 'story-1',
			actLineId: 'line-2',
		actNumber: 2,
		});

		await tool.execute!({ characterName: 'elena' }, { toolCallId: 'test', messages: [], abortSignal: undefined });
		expect(mockMemory.getInventory).toHaveBeenCalledWith('elena', {
			storyId: 'story-1',
			actLineIds: ['line-1', 'line-2'],
			category: undefined,
		});
	});

	it('returns inventory changes when includeHistory is true', async () => {
		const changes: InventoryChange[] = [
			{
				id: 'c1',
				storyId: 'story-1',
				actLineId: 'line-1',
				characterCanonicalName: 'elena',
				itemName: 'Iron Sword',
				changeType: 'acquired',
				description: 'Found in the ruins',
				messageId: 'msg-1',
				createdAt: null,
			},
			{
				id: 'c2',
				storyId: 'story-1',
				actLineId: 'line-1',
				characterCanonicalName: 'elena',
				itemName: 'Wooden Shield',
				changeType: 'lost',
				description: 'Shattered by the golem',
				messageId: 'msg-2',
				createdAt: null,
			},
		];
		const mockMemory = createMockMemory(sampleItems, changes);
		const tool = createQueryInventoryTool({
			memory: mockMemory as Memory,
			storyId: 'story-1',
			actLineId: 'line-2',
		actNumber: 2,
		});

		const result = (await tool.execute!(
			{ characterName: 'elena', includeHistory: true },
			{ toolCallId: 'test', messages: [], abortSignal: undefined }
		)) as unknown as QueryInventoryOutput;
		expect(result.inventory).toHaveLength(2);
		expect(result.changes).toBeDefined();
		expect(result.changes).toHaveLength(2);
		expect(result.changes![0].itemName).toBe('Iron Sword');
		expect(result.changes![0].changeType).toBe('acquired');
		expect(result.changes![0].description).toBe('Found in the ruins');
	});

	it('omits changes when includeHistory is not set', async () => {
		const changes: InventoryChange[] = [
			{
				id: 'c1',
				storyId: 'story-1',
				actLineId: 'line-1',
				characterCanonicalName: 'elena',
				itemName: 'Iron Sword',
				changeType: 'acquired',
				description: null,
				messageId: 'msg-1',
				createdAt: null,
			},
		];
		const mockMemory = createMockMemory(sampleItems, changes);
		const tool = createQueryInventoryTool({
			memory: mockMemory as Memory,
			storyId: 'story-1',
			actLineId: 'line-2',
		actNumber: 2,
		});

		const result = (await tool.execute!(
			{ characterName: 'elena' },
			{ toolCallId: 'test', messages: [], abortSignal: undefined }
		)) as unknown as QueryInventoryOutput;
		expect(result.inventory).toHaveLength(2);
		expect(result.changes).toBeUndefined();
		expect(mockMemory.getInventoryChanges).not.toHaveBeenCalled();
	});

	it('calls traceActLineChain and passes lineage actLineIds', async () => {
		const mockMemory = createMockMemory(sampleItems);
		const tool = createQueryInventoryTool({
			memory: mockMemory as Memory,
			storyId: 'story-1',
			actLineId: 'line-2',
		actNumber: 2,
		});

		await tool.execute!(
			{ characterName: 'elena' },
			{ toolCallId: 'test', messages: [], abortSignal: undefined }
		);

		expect(mockTraceActLineChain).toHaveBeenCalledWith('line-2');
		expect(mockMemory.resolveAliases).toHaveBeenCalledWith('story-1', ['line-1', 'line-2'], 'elena');
	});

	it('skips traceActLineChain in act 1 and uses only current actLineId', async () => {
		const mockMemory = createMockMemory(sampleItems);
		const tool = createQueryInventoryTool({
			memory: mockMemory as Memory,
			storyId: 'story-1',
			actLineId: 'line-1',
			actNumber: 1,
		});

		await tool.execute!(
			{ characterName: 'elena' },
			{ toolCallId: 'test', messages: [], abortSignal: undefined }
		);

		expect(mockTraceActLineChain).not.toHaveBeenCalled();
		expect(mockMemory.resolveAliases).toHaveBeenCalledWith('story-1', ['line-1'], 'elena');
	});
});
