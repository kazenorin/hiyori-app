import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDatabase } from './helpers/test-database';
import { runMigrations } from '#lib/db/migrations.ts';

let testDb: ReturnType<typeof createTestDatabase>;

vi.mock('#lib/db/database.ts', () => ({
	initDatabase: vi.fn(async () => testDb),
	getDatabase: vi.fn(() => testDb),
}));

import type { InventoryRow } from '#lib/db/inventory.ts';
import { inventoryCharacterNames, loadInventoryContext, type InventoryCharacter } from '#lib/features/inventory-context.ts';

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

async function seedRow(overrides: Partial<InventoryRow> & { id: string }): Promise<void> {
	const row: InventoryRow = {
		id: overrides.id,
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
