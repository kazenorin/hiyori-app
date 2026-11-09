import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockDbSelectResults: unknown[] = [];
const mockDb = {
	execute: vi.fn(async (_sql: string, _params?: unknown[]) => ({ rowsAffected: 0 })),
	select: vi.fn(async (_query: string, _params?: unknown[]) => {
		if (mockDbSelectResults.length > 0) {
			return mockDbSelectResults.shift();
		}
		return [];
	}),
};

vi.mock('#lib/db/database.ts', () => ({
	getDatabase: () => mockDb,
}));

import {
	appendInventoryEvents,
	deleteInventoryItemHistory,
	deleteInventoryRow,
	getInventoryRowsUpToScene,
	getLatestPerItem,
	resolveEquipStatus,
	updateInventoryRow,
	type InventoryRow,
} from '#lib/db/inventory.ts';

function makeRow(overrides: Partial<InventoryRow> = {}): InventoryRow {
	return {
		id: 'row-1',
		story_id: 'story-1',
		act_line_id: 'line-1',
		message_id: 'msg-1',
		scene_number: 1,
		character_canonical_name: 'elena',
		item_name: 'Iron Sword',
		event_type: 'acquired',
		category: 'equipment',
		equip_status: 'carried',
		description: null,
		created_at: null,
		...overrides,
	};
}

/** Extract the INSERT params from the nth execute call. */
function insertParams(callIndex = 0): unknown[] {
	return mockDb.execute.mock.calls[callIndex][1] as unknown[];
}

describe('inventory DB layer', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDbSelectResults = [];
	});

	describe('getLatestPerItem — state derivation', () => {
		it('keeps the latest row per item (by scene order)', async () => {
			mockDbSelectResults = [
				[
					makeRow({ id: '1', scene_number: 1, event_type: 'acquired', equip_status: 'carried', description: 'A battered blade' }),
					makeRow({ id: '2', scene_number: 3, event_type: 'equipped', equip_status: 'equipped', description: 'Drawn for battle' }),
				],
			];

			const items = await getLatestPerItem('line-1', ['elena']);
			expect(items).toHaveLength(1);
			expect(items[0].itemName).toBe('Iron Sword');
			expect(items[0].equipStatus).toBe('equipped');
			expect(items[0].description).toBe('Drawn for battle');
		});

		it('excludes items whose latest status is lost', async () => {
			mockDbSelectResults = [
				[
					makeRow({ id: '1', scene_number: 1, event_type: 'acquired', equip_status: 'carried' }),
					makeRow({ id: '2', scene_number: 2, event_type: 'lost', equip_status: 'lost' }),
				],
			];

			const items = await getLatestPerItem('line-1', ['elena']);
			expect(items).toHaveLength(0);
		});

		it('excludes items whose latest status is consumed', async () => {
			mockDbSelectResults = [
				[
					makeRow({ id: '1', item_name: 'Health Potion', scene_number: 1, event_type: 'acquired', equip_status: 'carried' }),
					makeRow({ id: '2', item_name: 'Health Potion', scene_number: 2, event_type: 'consumed', equip_status: 'consumed' }),
				],
			];

			const items = await getLatestPerItem('line-1', ['elena']);
			expect(items).toHaveLength(0);
		});

		it('shows a re-acquired item after it was lost', async () => {
			mockDbSelectResults = [
				[
					makeRow({ id: '1', scene_number: 1, event_type: 'acquired', equip_status: 'carried' }),
					makeRow({ id: '2', scene_number: 2, event_type: 'lost', equip_status: 'lost' }),
					makeRow({ id: '3', scene_number: 3, event_type: 'acquired', equip_status: 'carried' }),
				],
			];

			const items = await getLatestPerItem('line-1', ['elena']);
			expect(items).toHaveLength(1);
			expect(items[0].equipStatus).toBe('carried');
		});

		it('filters by the CURRENT category, not a stale one', async () => {
			const rows = [
				makeRow({ id: '1', scene_number: 1, event_type: 'acquired', category: 'item', equip_status: 'carried' }),
				makeRow({ id: '2', scene_number: 2, event_type: 'modified', category: 'equipment', equip_status: 'carried' }),
			];

			mockDbSelectResults = [rows];
			const asEquipment = await getLatestPerItem('line-1', ['elena'], 'equipment');
			expect(asEquipment).toHaveLength(1);
			expect(asEquipment[0].category).toBe('equipment');

			mockDbSelectResults = [rows];
			const asItem = await getLatestPerItem('line-1', ['elena'], 'item');
			expect(asItem).toHaveLength(0);
		});
	});

	describe('appendInventoryEvents — equip status mapping', () => {
		it('defaults acquired to carried', async () => {
			await appendInventoryEvents('story-1', 'line-1', 'msg-1', 1, [
				{ characterName: 'Elena', itemName: 'Iron Sword', eventType: 'acquired', category: 'equipment' },
			]);

			expect(insertParams()[9]).toBe('carried');
		});

		it('respects explicit equipStatus on acquired', async () => {
			await appendInventoryEvents('story-1', 'line-1', 'msg-1', 1, [
				{ characterName: 'Elena', itemName: 'Iron Sword', eventType: 'acquired', category: 'equipment', equipStatus: 'equipped' },
			]);

			expect(insertParams()[9]).toBe('equipped');
		});

		it('maps equipped event to equipped status', async () => {
			mockDbSelectResults = [[makeRow({ equip_status: 'carried' })]];
			await appendInventoryEvents('story-1', 'line-1', 'msg-2', 2, [
				{ characterName: 'Elena', itemName: 'Iron Sword', eventType: 'equipped' },
			]);

			expect(insertParams()[9]).toBe('equipped');
		});

		it('maps unequipped event to unequipped status', async () => {
			mockDbSelectResults = [[makeRow({ equip_status: 'equipped' })]];
			await appendInventoryEvents('story-1', 'line-1', 'msg-2', 2, [
				{ characterName: 'Elena', itemName: 'Iron Sword', eventType: 'unequipped' },
			]);

			expect(insertParams()[9]).toBe('unequipped');
		});

		it('maps lost event to lost status', async () => {
			mockDbSelectResults = [[makeRow({ equip_status: 'carried' })]];
			await appendInventoryEvents('story-1', 'line-1', 'msg-2', 2, [{ characterName: 'Elena', itemName: 'Iron Sword', eventType: 'lost' }]);

			expect(insertParams()[9]).toBe('lost');
		});

		it('maps consumed event to consumed status', async () => {
			mockDbSelectResults = [[makeRow({ item_name: 'Health Potion', equip_status: 'carried' })]];
			await appendInventoryEvents('story-1', 'line-1', 'msg-2', 2, [
				{ characterName: 'Elena', itemName: 'Health Potion', eventType: 'consumed' },
			]);

			expect(insertParams()[9]).toBe('consumed');
		});

		it('carries forward prior status on used', async () => {
			mockDbSelectResults = [[makeRow({ equip_status: 'equipped' })]];
			await appendInventoryEvents('story-1', 'line-1', 'msg-2', 2, [{ characterName: 'Elena', itemName: 'Iron Sword', eventType: 'used' }]);

			expect(insertParams()[9]).toBe('equipped');
		});

		it('defaults to carried on used with no prior row', async () => {
			mockDbSelectResults = [[]];
			await appendInventoryEvents('story-1', 'line-1', 'msg-2', 2, [
				{ characterName: 'Elena', itemName: 'Mystery Rock', eventType: 'used' },
			]);

			expect(insertParams()[9]).toBe('carried');
		});

		it('carries forward prior category on modified', async () => {
			mockDbSelectResults = [[makeRow({ category: 'equipment', equip_status: 'carried' })]];
			await appendInventoryEvents('story-1', 'line-1', 'msg-2', 2, [
				{ characterName: 'Elena', itemName: 'Iron Sword', eventType: 'modified', description: 'Now enchanted' },
			]);

			expect(insertParams()[8]).toBe('equipment');
		});
	});

	describe('resolveEquipStatus', () => {
		it('implies the status for equipped, unequipped, lost, and consumed', () => {
			expect(resolveEquipStatus('equipped', 'carried', 'carried')).toBe('equipped');
			expect(resolveEquipStatus('unequipped', 'equipped', 'equipped')).toBe('unequipped');
			expect(resolveEquipStatus('lost', 'carried', 'carried')).toBe('lost');
			expect(resolveEquipStatus('consumed', 'carried', 'carried')).toBe('consumed');
		});

		it('defaults acquired to carried but honors an explicit request', () => {
			expect(resolveEquipStatus('acquired', undefined, undefined)).toBe('carried');
			expect(resolveEquipStatus('acquired', 'equipped', undefined)).toBe('equipped');
		});

		it('falls back requested -> prior -> carried for other events', () => {
			expect(resolveEquipStatus('used', 'known', 'equipped')).toBe('known');
			expect(resolveEquipStatus('used', undefined, 'equipped')).toBe('equipped');
			expect(resolveEquipStatus('used', undefined, undefined)).toBe('carried');
		});
	});

	describe('appendInventoryEvents — alias-aware inheritance', () => {
		it('looks up the prior row across every supplied canonical name', async () => {
			mockDbSelectResults = [[makeRow({ category: 'equipment', equip_status: 'equipped' })]];

			await appendInventoryEvents(
				'story-1',
				'line-1',
				'msg-3',
				3,
				[{ characterName: 'Elena', itemName: 'Iron Sword', eventType: 'modified' }],
				{ priorNames: ['elena', 'elena-the-brave'] }
			);

			expect(mockDb.select).toHaveBeenCalledWith(expect.stringContaining('character_canonical_name IN ($2,$3)'), [
				'line-1',
				'elena',
				'elena-the-brave',
				'Iron Sword',
			]);
			expect(insertParams()[8]).toBe('equipment');
			expect(insertParams()[9]).toBe('equipped');
		});

		it('clears the category when null is passed', async () => {
			mockDbSelectResults = [[makeRow({ category: 'equipment', equip_status: 'carried' })]];

			await appendInventoryEvents('story-1', 'line-1', 'msg-2', 2, [
				{ characterName: 'Elena', itemName: 'Iron Sword', eventType: 'modified', category: null },
			]);

			expect(insertParams()[8]).toBeNull();
		});

		it('inherits the category when undefined is passed', async () => {
			mockDbSelectResults = [[makeRow({ category: 'equipment', equip_status: 'carried' })]];

			await appendInventoryEvents('story-1', 'line-1', 'msg-2', 2, [
				{ characterName: 'Elena', itemName: 'Iron Sword', eventType: 'modified' },
			]);

			expect(insertParams()[8]).toBe('equipment');
		});
	});

	describe('scene-scoped reads and row writes', () => {
		it('selects rows up to the scene, including baseline rows', async () => {
			mockDbSelectResults = [[makeRow({ id: 'baseline', scene_number: null }), makeRow({ id: 'scene-1', scene_number: 1 })]];

			const rows = await getInventoryRowsUpToScene('line-1', ['elena', 'elena-the-brave'], 2);

			expect(rows).toHaveLength(2);
			expect(mockDb.select).toHaveBeenCalledWith(expect.stringContaining('scene_number IS NULL OR scene_number <= $4'), [
				'line-1',
				'elena',
				'elena-the-brave',
				2,
			]);
			expect(mockDb.select).toHaveBeenCalledWith(expect.stringContaining('ORDER BY COALESCE(scene_number, -1) ASC, rowid ASC'), [
				'line-1',
				'elena',
				'elena-the-brave',
				2,
			]);
		});

		it('returns no rows without querying when no names are supplied', async () => {
			await expect(getInventoryRowsUpToScene('line-1', [], 2)).resolves.toEqual([]);
			expect(mockDb.select).not.toHaveBeenCalled();
		});

		it('updates one row and returns the affected count', async () => {
			mockDb.execute.mockResolvedValueOnce({ rowsAffected: 1 });

			const affected = await updateInventoryRow('row-1', 'line-1', {
				eventType: 'equipped',
				category: 'equipment',
				equipStatus: 'equipped',
				description: null,
			});

			expect(affected).toBe(1);
			expect(mockDb.execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE inventory SET'), [
				'row-1',
				'line-1',
				'equipped',
				'equipment',
				'equipped',
				null,
			]);
		});

		it('deletes one row and returns the affected count', async () => {
			mockDb.execute.mockResolvedValueOnce({ rowsAffected: 1 });

			await expect(deleteInventoryRow('row-1', 'line-1')).resolves.toBe(1);
			expect(mockDb.execute).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM inventory WHERE id = $1 AND act_line_id = $2'), [
				'row-1',
				'line-1',
			]);
		});

		it('deletes every history row for the item across names', async () => {
			mockDb.execute.mockResolvedValueOnce({ rowsAffected: 3 });

			await expect(deleteInventoryItemHistory('line-1', ['elena', 'elena-the-brave'], 'Iron Sword')).resolves.toBe(3);
			expect(mockDb.execute).toHaveBeenCalledWith(expect.stringContaining('item_name = $4'), [
				'line-1',
				'elena',
				'elena-the-brave',
				'Iron Sword',
			]);
		});
	});
});
