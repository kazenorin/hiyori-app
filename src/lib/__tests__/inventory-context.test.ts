import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDatabase } from './helpers/test-database';
import { runMigrations } from '#lib/db/migrations.ts';

let testDb: ReturnType<typeof createTestDatabase>;

vi.mock('#lib/db/database.ts', () => ({
	initDatabase: vi.fn(async () => testDb),
	getDatabase: vi.fn(() => testDb),
}));

import type { InventoryRow } from '#lib/db/inventory.ts';
import {
	DuplicateInventoryItemError,
	addInventoryEntry,
	inventoryCharacterNames,
	loadInventoryContext,
	removeInventoryEntry,
	updateInventoryEntry,
	type InventoryCharacter,
	type InventoryEntryDraft,
} from '#lib/features/inventory-context.ts';

const LINE = 'line-1';
const STORY = 'story-1';
const CHARACTER: InventoryCharacter = { canonicalName: 'elena', aliases: ['Elena', 'Elena the Brave'] };

async function seedScene(sceneNumber: number): Promise<void> {
	const messageId = `msg-${sceneNumber}`;
	await testDb.execute('INSERT INTO messages (id, role, content, scene_number, created_at) VALUES ($1, $2, $3, $4, $5)', [
		messageId,
		'assistant',
		'',
		sceneNumber,
		1000 + sceneNumber,
	]);
	await testDb.execute('INSERT INTO act_lines (act_line_id, message_id, sequence) VALUES ($1, $2, $3)', [LINE, messageId, sceneNumber]);
}

async function seedRow({ id, ...overrides }: Omit<Partial<InventoryRow>, 'id'> & { id: string }): Promise<void> {
	const row: InventoryRow = {
		id,
		story_id: STORY,
		act_line_id: LINE,
		message_id: `msg-${overrides.scene_number ?? 'baseline'}`,
		scene_number: null,
		character_canonical_name: 'elena',
		item_name: 'Iron Sword',
		event_type: 'acquired',
		category: 'equipment',
		equip_status: 'carried',
		description: null,
		created_at: null,
		...overrides,
	};
	await testDb.execute(
		`INSERT INTO inventory (id, story_id, act_line_id, message_id, scene_number, character_canonical_name, item_name, event_type, category, equip_status, description, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		[
			row.id,
			row.story_id,
			row.act_line_id,
			row.message_id,
			row.scene_number,
			row.character_canonical_name,
			row.item_name,
			row.event_type,
			row.category,
			row.equip_status,
			row.description,
			row.created_at,
		]
	);
}

describe('inventory context — load', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
	});

	afterEach(() => {
		testDb.close();
	});

	it('canonicalizes and deduplicates the character names', () => {
		expect(inventoryCharacterNames({ canonicalName: 'elena', aliases: ['Elena', 'Elena the Brave', 'elena'] })).toEqual([
			'elena',
			'elena-the-brave',
		]);
	});

	it('reads only rows up to the selected scene and orders history ascending', async () => {
		await seedScene(1);
		await seedScene(2);
		await seedScene(3);
		await seedRow({ id: 'r1', scene_number: 1, event_type: 'acquired', equip_status: 'carried' });
		await seedRow({ id: 'r2', scene_number: 2, event_type: 'modified', category: 'item', equip_status: 'carried' });
		await seedRow({ id: 'r3', scene_number: 3, event_type: 'equipped', category: 'equipment', equip_status: 'equipped' });

		const context = await loadInventoryContext(LINE, CHARACTER, 2);

		expect(context.items).toHaveLength(1);
		expect(context.items[0].entries.map((entry) => entry.id)).toEqual(['r1', 'r2']);
		expect(context.items[0].category).toBe('item');
		expect(context.items[0].equipStatus).toBe('carried');
	});

	it('includes baseline rows and splits held from inactive items', async () => {
		await seedScene(1);
		await seedScene(2);
		await seedRow({ id: 'base', scene_number: null, item_name: 'Old Map' });
		await seedRow({ id: 'sword-1', scene_number: 1, event_type: 'acquired' });
		await seedRow({ id: 'sword-2', scene_number: 2, event_type: 'lost', equip_status: 'lost' });

		const context = await loadInventoryContext(LINE, CHARACTER, 2);

		expect(context.items.map((item) => item.itemName)).toEqual(['Old Map']);
		expect(context.inactiveItems.map((item) => item.itemName)).toEqual(['Iron Sword']);
		expect(context.inactiveItems[0].entries.map((entry) => entry.id)).toEqual(['sword-1', 'sword-2']);
		expect(context.inactiveItems[0].equipStatus).toBe('lost');
	});

	it('orders a baseline row before the same item’s scene rows', async () => {
		await seedScene(1);
		await seedScene(2);
		await seedRow({ id: 'base', scene_number: null, category: 'equipment', equip_status: 'carried' });
		await seedRow({ id: 'scene-1', scene_number: 1, event_type: 'modified', category: 'item', equip_status: 'carried' });

		const context = await loadInventoryContext(LINE, CHARACTER, 2);

		expect(context.items[0].entries.map((entry) => entry.id)).toEqual(['base', 'scene-1']);
		expect(context.items[0].category).toBe('item');
	});

	it('merges alias-owned rows into one item and keeps the latest owner', async () => {
		await seedScene(1);
		await seedScene(2);
		await seedRow({ id: 'a1', scene_number: 1, character_canonical_name: 'elena-the-brave', event_type: 'acquired' });
		await seedRow({ id: 'a2', scene_number: 2, character_canonical_name: 'elena', event_type: 'modified' });

		const context = await loadInventoryContext(LINE, CHARACTER, 2);

		expect(context.items).toHaveLength(1);
		expect(context.items[0].entries.map((entry) => entry.ownerName)).toEqual(['elena-the-brave', 'elena']);
		expect(context.items[0].ownerName).toBe('elena');
	});

	it('is editable only at the latest scene', async () => {
		await seedScene(1);
		await seedScene(2);

		await expect(loadInventoryContext(LINE, CHARACTER, 1)).resolves.toMatchObject({ editable: false });
		await expect(loadInventoryContext(LINE, CHARACTER, 2)).resolves.toMatchObject({ editable: true });
	});

	it('keeps inactive items reachable with their full entries', async () => {
		await seedScene(1);
		await seedRow({ id: 'consumed', scene_number: 1, item_name: 'Potion', event_type: 'consumed', equip_status: 'consumed' });

		const context = await loadInventoryContext(LINE, CHARACTER, 1);

		expect(context.items).toHaveLength(0);
		expect(context.inactiveItems[0].entries).toHaveLength(1);
		expect(context.inactiveItems[0].entries[0].eventType).toBe('consumed');
	});
});

async function rawRows(): Promise<InventoryRow[]> {
	return testDb.select<InventoryRow[]>('SELECT * FROM inventory ORDER BY rowid ASC');
}

function draft(overrides: Partial<InventoryEntryDraft> = {}): InventoryEntryDraft {
	return {
		itemName: 'Iron Sword',
		eventType: 'acquired',
		category: 'equipment',
		description: null,
		...overrides,
	};
}

describe('inventory context — mutations', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
	});

	afterEach(() => {
		testDb.close();
	});

	it('adds a new item under the canonical name at the latest scene', async () => {
		await seedScene(1);
		await seedScene(2);

		await addInventoryEntry(STORY, LINE, 'msg-2', 2, CHARACTER, draft({ itemName: '  Cloak  ' }), 'item');

		const rows = await rawRows();
		expect(rows).toHaveLength(1);
		expect(rows[0].item_name).toBe('Cloak');
		expect(rows[0].character_canonical_name).toBe('elena');
		expect(rows[0].message_id).toBe('msg-2');
		expect(rows[0].scene_number).toBe(2);
		expect(rows[0].equip_status).toBe('carried');
	});

	it('rejects add when the selected scene is not the latest', async () => {
		await seedScene(1);
		await seedScene(2);

		await expect(addInventoryEntry(STORY, LINE, 'msg-1', 1, CHARACTER, draft(), 'item')).rejects.toThrow(/latest scene/);
	});

	it('trims Add item input, rejects duplicates, and preserves exact names for entries', async () => {
		await seedScene(1);
		await seedRow({ id: 'plain', scene_number: 1, item_name: 'Sword' });
		await seedRow({ id: 'spaced', scene_number: 1, item_name: 'Sword ', category: 'equipment', equip_status: 'carried' });

		await expect(addInventoryEntry(STORY, LINE, 'msg-1', 1, CHARACTER, draft({ itemName: '  Sword  ' }), 'item')).rejects.toBeInstanceOf(
			DuplicateInventoryItemError
		);

		await addInventoryEntry(STORY, LINE, 'msg-1', 1, CHARACTER, draft({ itemName: '  Cloak  ' }), 'item');
		await addInventoryEntry(
			STORY,
			LINE,
			'msg-1',
			1,
			CHARACTER,
			draft({ itemName: 'Sword ', eventType: 'modified', category: undefined, description: 'Exact spaced name' }),
			'entry',
			'elena'
		);

		const rows = await rawRows();
		expect(rows.map((row) => row.item_name)).toEqual(['Sword', 'Sword ', 'Cloak', 'Sword ']);
		expect(rows[3].description).toBe('Exact spaced name');
		expect(rows[3].category).toBe('equipment');
	});

	it('adds an entry to an alias-owned item, inheriting category and status under the owner name', async () => {
		await seedScene(1);
		await seedScene(2);
		await seedRow({
			id: 'alias-row',
			scene_number: 1,
			character_canonical_name: 'elena-the-brave',
			category: 'equipment',
			equip_status: 'equipped',
		});

		await addInventoryEntry(
			STORY,
			LINE,
			'msg-2',
			2,
			CHARACTER,
			draft({ eventType: 'modified', category: undefined, description: 'Reforged' }),
			'entry',
			'elena-the-brave'
		);

		const rows = await rawRows();
		expect(rows[1].character_canonical_name).toBe('elena-the-brave');
		expect(rows[1].category).toBe('equipment');
		expect(rows[1].equip_status).toBe('equipped');

		const context = await loadInventoryContext(LINE, CHARACTER, 2);
		expect(context.items).toHaveLength(1);
		expect(context.items[0].entries.map((entry) => entry.id)).toHaveLength(2);
	});

	it('clears the category with null and rejects undefined for acquired on Add entry', async () => {
		await seedScene(1);
		await seedRow({ id: 'base', scene_number: 1, category: 'equipment' });

		await addInventoryEntry(STORY, LINE, 'msg-1', 1, CHARACTER, draft({ eventType: 'modified', category: null }), 'entry', 'elena');
		expect((await rawRows())[1].category).toBeNull();

		await addInventoryEntry(STORY, LINE, 'msg-1', 1, CHARACTER, draft({ eventType: 'acquired', category: null }), 'entry', 'elena');
		expect((await rawRows())[2].category).toBeNull();

		await expect(
			addInventoryEntry(STORY, LINE, 'msg-1', 1, CHARACTER, draft({ eventType: 'acquired', category: undefined }), 'entry', 'elena')
		).rejects.toThrow(/explicit category/);
	});

	it('updates the current-scene entry and resolves implied status', async () => {
		await seedScene(1);
		await seedScene(2);
		await seedRow({ id: 'row-1', scene_number: 2, event_type: 'acquired', category: 'equipment', equip_status: 'carried' });
		const [entry] = (await loadInventoryContext(LINE, CHARACTER, 2)).items[0].entries;

		await updateInventoryEntry(LINE, 2, entry, draft({ eventType: 'equipped', category: 'item', description: '  Drawn  ' }));

		const [row] = await rawRows();
		expect(row.event_type).toBe('equipped');
		expect(row.equip_status).toBe('equipped');
		expect(row.category).toBe('item');
		expect(row.description).toBe('Drawn');
		expect(row.item_name).toBe('Iron Sword');
	});

	it('rejects updating an entry from an earlier scene and stale rows', async () => {
		await seedScene(1);
		await seedScene(2);
		await seedRow({ id: 'old', scene_number: 1 });
		await seedRow({ id: 'new', scene_number: 2 });
		const context = await loadInventoryContext(LINE, CHARACTER, 2);
		const oldEntry = context.items[0].entries[0];

		await expect(updateInventoryEntry(LINE, 2, oldEntry, draft())).rejects.toThrow(/selected scene/);
		await expect(updateInventoryEntry(LINE, 2, { ...oldEntry, id: 'missing', sceneNumber: 2 }, draft())).rejects.toThrow(/stale/);
	});

	it('deletes only a current-scene entry', async () => {
		await seedScene(1);
		await seedScene(2);
		await seedRow({ id: 'old', scene_number: 1 });
		await seedRow({ id: 'new', scene_number: 2 });
		const [oldEntry, newEntry] = (await loadInventoryContext(LINE, CHARACTER, 2)).items[0].entries;

		await expect(removeInventoryEntry(LINE, 2, CHARACTER, oldEntry, 'entry')).rejects.toThrow(/selected scene/);
		await removeInventoryEntry(LINE, 2, CHARACTER, newEntry, 'entry');

		expect((await rawRows()).map((row) => row.id)).toEqual(['old']);
	});

	it('rejects deleting a stale entry row', async () => {
		await seedScene(1);
		await seedRow({ id: 'row-1', scene_number: 1 });
		const [entry] = (await loadInventoryContext(LINE, CHARACTER, 1)).items[0].entries;

		await expect(removeInventoryEntry(LINE, 1, CHARACTER, { ...entry, id: 'missing' }, 'entry')).rejects.toThrow(/stale/);
	});

	it('rejects editing with an undefined category', async () => {
		await seedScene(1);
		await seedRow({ id: 'row-1', scene_number: 1 });
		const [entry] = (await loadInventoryContext(LINE, CHARACTER, 1)).items[0].entries;

		await expect(updateInventoryEntry(LINE, 1, entry, draft({ category: undefined }))).rejects.toThrow(/explicit category/);
	});

	it('erases the full history across alias-owned rows', async () => {
		await seedScene(1);
		await seedRow({ id: 'a', scene_number: 1, character_canonical_name: 'elena' });
		await seedRow({ id: 'b', scene_number: null, character_canonical_name: 'elena-the-brave' });
		const [entry] = (await loadInventoryContext(LINE, CHARACTER, 1)).items[0].entries;

		await removeInventoryEntry(LINE, 1, CHARACTER, entry, 'history');

		expect(await rawRows()).toHaveLength(0);
	});

	it('requires the latest scene for history erasure', async () => {
		await seedScene(1);
		await seedScene(2);
		await seedRow({ id: 'old', scene_number: 1 });
		await seedRow({ id: 'new', scene_number: 2 });
		const [entry] = (await loadInventoryContext(LINE, CHARACTER, 2)).items[0].entries;

		await expect(removeInventoryEntry(LINE, 1, CHARACTER, entry, 'history')).rejects.toThrow(/latest scene/);
	});
});
