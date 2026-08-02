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

const mockTraceActLineChain = vi.fn(async (actLineId: string, _descending?: boolean) => [
	{ actLineId, actNumber: 2, isMainLine: false },
	{ actLineId: 'line-1', actNumber: 1, isMainLine: true },
]);

vi.mock('$lib/db/act-lines', () => ({}));

vi.mock('$lib/db/acts', () => ({
	traceActLineChain: (actLineId: string, descending?: boolean) => mockTraceActLineChain(actLineId, descending),
}));

const mockGetLatestPerItem = vi.fn(async (_actLineId: string, _names: string[], _category?: unknown): Promise<InventoryItem[]> => []);
const mockGetInventoryEvents = vi.fn(async (_names: string[], _opts: unknown): Promise<InventoryEvent[]> => []);
const mockResolveCharacterNames = vi.fn(async (_actLineId: string, name: string): Promise<string[]> => [name]);

vi.mock('$lib/db/inventory', () => ({
	getLatestPerItem: (...args: unknown[]) => mockGetLatestPerItem(...(args as [string, string[], unknown])),
	getInventoryEvents: (...args: unknown[]) => mockGetInventoryEvents(...(args as [string[], unknown])),
	resolveCharacterNames: (...args: unknown[]) => mockResolveCharacterNames(...(args as [string, string])),
}));

import { createQueryInventoryTool } from '$lib/ai/tools/query-inventory';
import type { InventoryItem, InventoryEvent } from '$lib/db/inventory';

interface InventoryResult {
	name: string;
	category: string | null;
	equipStatus: string | null;
	description: string | null;
}

interface InventoryEventResult {
	itemName: string;
	eventType: string;
	description: string | null;
}

interface QueryInventoryOutput {
	inventory: InventoryResult[];
	events?: InventoryEventResult[];
}

const sampleItems: InventoryItem[] = [
	{
		itemName: 'Iron Sword',
		category: 'item',
		equipStatus: 'carried',
		description: 'A battered blade',
		eventType: 'acquired',
		messageId: 'msg-1',
		sceneNumber: 1,
	},
	{
		itemName: 'Leather Armor',
		category: 'equipment',
		equipStatus: 'equipped',
		description: null,
		eventType: 'equipped',
		messageId: 'msg-2',
		sceneNumber: 2,
	},
];

describe('createQueryInventoryTool', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetLatestPerItem.mockResolvedValue([]);
		mockGetInventoryEvents.mockResolvedValue([]);
		mockResolveCharacterNames.mockImplementation(async (_actLineId: string, name: string) => [name]);
	});

	it('returns inventory items for a character', async () => {
		mockGetLatestPerItem.mockResolvedValue(sampleItems);
		const tool = createQueryInventoryTool({
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
				itemName: 'Iron Sword',
				category: 'item',
				equipStatus: 'carried',
				description: null,
				eventType: 'acquired',
				messageId: 'msg-1',
				sceneNumber: 1,
			},
			{
				itemName: 'Healing Potion',
				category: 'item',
				equipStatus: 'carried',
				description: null,
				eventType: 'acquired',
				messageId: 'msg-2',
				sceneNumber: 2,
			},
		];
		mockResolveCharacterNames.mockResolvedValue(['elena-shadowcrest', 'Elena']);
		mockGetLatestPerItem.mockImplementation(async (_actLineId: string, names: string[]) =>
			items.filter((item) => names.includes(item.itemName === 'Iron Sword' ? 'elena-shadowcrest' : 'Elena'))
		);

		const tool = createQueryInventoryTool({
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
		const tool = createQueryInventoryTool({
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

	it('child act line items take precedence over parent', async () => {
		const childItems: InventoryItem[] = [
			{
				itemName: 'Iron Sword',
				category: 'equipment',
				equipStatus: 'equipped',
				description: 'Now enchanted',
				eventType: 'modified',
				messageId: 'msg-5',
				sceneNumber: 5,
			},
		];
		const parentItems: InventoryItem[] = [
			{
				itemName: 'Iron Sword',
				category: 'item',
				equipStatus: 'carried',
				description: 'A battered blade',
				eventType: 'acquired',
				messageId: 'msg-1',
				sceneNumber: 1,
			},
			{
				itemName: 'Shield',
				category: 'equipment',
				equipStatus: 'carried',
				description: null,
				eventType: 'acquired',
				messageId: 'msg-2',
				sceneNumber: 2,
			},
		];

		mockGetLatestPerItem.mockImplementation(async (actLineId: string) =>
			actLineId === 'line-2' ? childItems : parentItems
		);

		const tool = createQueryInventoryTool({
			storyId: 'story-1',
			actLineId: 'line-2',
			actNumber: 2,
		});

		const result = (await tool.execute!(
			{ characterName: 'elena' },
			{ toolCallId: 'test', messages: [], abortSignal: undefined }
		)) as unknown as QueryInventoryOutput;

		expect(result.inventory).toHaveLength(2);
		const sword = result.inventory.find((i) => i.name === 'Iron Sword');
		expect(sword?.equipStatus).toBe('equipped');
		expect(sword?.description).toBe('Now enchanted');
		expect(result.inventory.find((i) => i.name === 'Shield')).toBeDefined();
	});

	it('filters by category when provided', async () => {
		const tool = createQueryInventoryTool({
			storyId: 'story-1',
			actLineId: 'line-2',
			actNumber: 2,
		});

		await tool.execute!({ characterName: 'elena', itemCategory: 'skill' }, { toolCallId: 'test', messages: [], abortSignal: undefined });
		expect(mockGetLatestPerItem).toHaveBeenCalledWith('line-2', ['elena'], 'skill');
	});

	it('returns events when includeHistory is true', async () => {
		const events: InventoryEvent[] = [
			{
				itemName: 'Iron Sword',
				eventType: 'acquired',
				description: 'Found in the ruins',
				messageId: 'msg-1',
				sceneNumber: 1,
				createdAt: null,
			},
			{
				itemName: 'Wooden Shield',
				eventType: 'lost',
				description: 'Shattered by the golem',
				messageId: 'msg-2',
				sceneNumber: 2,
				createdAt: null,
			},
		];
		mockGetLatestPerItem.mockResolvedValue(sampleItems);
		mockGetInventoryEvents.mockResolvedValue(events);
		const tool = createQueryInventoryTool({
			storyId: 'story-1',
			actLineId: 'line-2',
			actNumber: 2,
		});

		const result = (await tool.execute!(
			{ characterName: 'elena', includeHistory: true },
			{ toolCallId: 'test', messages: [], abortSignal: undefined }
		)) as unknown as QueryInventoryOutput;
		expect(result.inventory).toHaveLength(2);
		expect(result.events).toBeDefined();
		expect(result.events).toHaveLength(2);
		expect(result.events![0].itemName).toBe('Iron Sword');
		expect(result.events![0].eventType).toBe('acquired');
		expect(result.events![0].description).toBe('Found in the ruins');
	});

	it('omits events when includeHistory is not set', async () => {
		mockGetLatestPerItem.mockResolvedValue(sampleItems);
		const tool = createQueryInventoryTool({
			storyId: 'story-1',
			actLineId: 'line-2',
			actNumber: 2,
		});

		const result = (await tool.execute!(
			{ characterName: 'elena' },
			{ toolCallId: 'test', messages: [], abortSignal: undefined }
		)) as unknown as QueryInventoryOutput;
		expect(result.inventory).toHaveLength(2);
		expect(result.events).toBeUndefined();
		expect(mockGetInventoryEvents).not.toHaveBeenCalled();
	});

	it('calls traceActLineChain for act > 1', async () => {
		const tool = createQueryInventoryTool({
			storyId: 'story-1',
			actLineId: 'line-2',
			actNumber: 2,
		});

		await tool.execute!({ characterName: 'elena' }, { toolCallId: 'test', messages: [], abortSignal: undefined });

		expect(mockTraceActLineChain).toHaveBeenCalledWith('line-2', true);
		expect(mockResolveCharacterNames).toHaveBeenCalledWith('line-2', 'elena');
	});

	it('skips traceActLineChain in act 1 and uses only current actLineId', async () => {
		const tool = createQueryInventoryTool({
			storyId: 'story-1',
			actLineId: 'line-1',
			actNumber: 1,
		});

		await tool.execute!({ characterName: 'elena' }, { toolCallId: 'test', messages: [], abortSignal: undefined });

		expect(mockTraceActLineChain).not.toHaveBeenCalled();
		expect(mockGetLatestPerItem).toHaveBeenCalledWith('line-1', ['elena'], undefined);
	});
});
