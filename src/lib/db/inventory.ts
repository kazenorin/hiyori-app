import { getDatabase } from './database';
import { getLatestProfileByAlias, toCanonicalName } from './character-profiles';
import { traceActLineChain } from './acts';

export type InventoryCategory = 'item' | 'equipment' | 'skill' | 'clothing' | 'status';

export type EquipStatus = 'equipped' | 'carried' | 'owned' | 'known';

export type InventoryChangeType = 'acquired' | 'lost' | 'equipped' | 'unequipped' | 'used' | 'modified';

export const INVENTORY_CATEGORIES: readonly InventoryCategory[] = ['item', 'equipment', 'skill', 'clothing', 'status'] as const;

export const EQUIP_STATUSES: readonly EquipStatus[] = ['equipped', 'carried', 'owned', 'known'] as const;

export const INVENTORY_CHANGE_TYPES: readonly InventoryChangeType[] = [
	'acquired',
	'lost',
	'equipped',
	'unequipped',
	'used',
	'modified',
] as const;

export interface InventoryItem {
	id: string;
	storyId: string;
	actLineId: string;
	characterCanonicalName: string;
	itemName: string;
	category: InventoryCategory;
	equipStatus: EquipStatus;
	description: string | null;
	messageId: string;
	createdAt: string | null;
}

export interface InventoryChange {
	id: string;
	storyId: string;
	actLineId: string;
	characterCanonicalName: string;
	itemName: string;
	changeType: InventoryChangeType;
	description: string | null;
	messageId: string;
	createdAt: string | null;
}

interface InventoryRow {
	id: string;
	story_id: string;
	act_line_id: string;
	character_canonical_name: string;
	item_name: string;
	category: string;
	equip_status: string;
	description: string | null;
	message_id: string;
	created_at: string | null;
}

interface InventoryChangeRow {
	id: string;
	story_id: string;
	act_line_id: string;
	character_canonical_name: string;
	item_name: string;
	change_type: string;
	description: string | null;
	message_id: string;
	created_at: string | null;
}

function mapRowToItem(row: InventoryRow): InventoryItem {
	return {
		id: row.id,
		storyId: row.story_id,
		actLineId: row.act_line_id,
		characterCanonicalName: row.character_canonical_name,
		itemName: row.item_name,
		category: row.category as InventoryCategory,
		equipStatus: row.equip_status as EquipStatus,
		description: row.description,
		messageId: row.message_id,
		createdAt: row.created_at,
	};
}

function mapRowToChange(row: InventoryChangeRow): InventoryChange {
	return {
		id: row.id,
		storyId: row.story_id,
		actLineId: row.act_line_id,
		characterCanonicalName: row.character_canonical_name,
		itemName: row.item_name,
		changeType: row.change_type as InventoryChangeType,
		description: row.description,
		messageId: row.message_id,
		createdAt: row.created_at,
	};
}

export interface UpsertInventoryItemInput {
	characterName: string;
	itemName: string;
	category: InventoryCategory;
	equipStatus: EquipStatus;
	description?: string;
}

export interface InsertInventoryChangeInput {
	characterName: string;
	itemName: string;
	changeType: InventoryChangeType;
	description?: string;
}

export async function upsertInventoryItems(
	storyId: string,
	actLineId: string,
	messageId: string,
	items: UpsertInventoryItemInput[]
): Promise<void> {
	const db = getDatabase();
	for (const item of items) {
		const canonical = toCanonicalName(item.characterName);
		await db.execute(
			`INSERT INTO inventory (id, story_id, act_line_id, character_canonical_name, item_name, category, equip_status, description, message_id)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			 ON CONFLICT(act_line_id, character_canonical_name, item_name)
			 DO UPDATE SET category = $6, equip_status = $7, description = $8, message_id = $9`,
			[crypto.randomUUID(), storyId, actLineId, canonical, item.itemName, item.category, item.equipStatus, item.description ?? null, messageId]
		);
	}
}

export async function insertInventoryChanges(
	storyId: string,
	actLineId: string,
	messageId: string,
	changes: InsertInventoryChangeInput[]
): Promise<void> {
	const db = getDatabase();
	for (const change of changes) {
		const canonical = toCanonicalName(change.characterName);
		await db.execute(
			`INSERT INTO inventory_changes (id, story_id, act_line_id, character_canonical_name, item_name, change_type, description, message_id)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			[crypto.randomUUID(), storyId, actLineId, canonical, change.itemName, change.changeType, change.description ?? null, messageId]
		);
	}
}

export async function getInventory(
	characterCanonicalName: string,
	opts: { storyId: string; actLineIds: string[]; category?: InventoryCategory }
): Promise<InventoryItem[]> {
	const db = getDatabase();
	const placeholders = opts.actLineIds.map((_, i) => `$${i + 3}`).join(',');
	const params: (string | number)[] = [opts.storyId, characterCanonicalName, ...opts.actLineIds];

	let query = `SELECT * FROM inventory WHERE story_id = $1 AND character_canonical_name = $2 AND act_line_id IN (${placeholders})`;
	if (opts.category) {
		params.push(opts.category);
		query += ` AND category = $${params.length}`;
	}
	query += ' ORDER BY created_at ASC';

	const rows = await db.select<InventoryRow[]>(query, params);

	const seen = new Map<string, InventoryItem>();
	for (const row of rows) {
		const key = `${row.character_canonical_name}|${row.item_name}`;
		seen.set(key, mapRowToItem(row));
	}
	return [...seen.values()];
}

export async function getInventoryChanges(
	characterCanonicalName: string,
	opts: { storyId: string; actLineIds: string[] }
): Promise<InventoryChange[]> {
	const db = getDatabase();
	const placeholders = opts.actLineIds.map((_, i) => `$${i + 3}`).join(',');
	const rows = await db.select<InventoryChangeRow[]>(
		`SELECT * FROM inventory_changes WHERE story_id = $1 AND character_canonical_name = $2 AND act_line_id IN (${placeholders}) ORDER BY created_at ASC`,
		[opts.storyId, characterCanonicalName, ...opts.actLineIds]
	);
	return rows.map(mapRowToChange);
}

export async function resolveCharacterNames(actLineId: string, name: string): Promise<string[]> {
	const canonical = toCanonicalName(name);
	const chain = await traceActLineChain(actLineId, true);
	for (const link of chain) {
		const profile = await getLatestProfileByAlias(link.actLineId, name);
		if (profile) {
			return [profile.canonicalName, canonical, ...profile.aliases.map(toCanonicalName)].filter(
				(v, i, a) => a.indexOf(v) === i
			);
		}
	}
	return [canonical];
}

export async function deleteInventoryByMessages(actLineId: string, messageIds: string[]): Promise<void> {
	const db = getDatabase();
	const placeholders = messageIds.map((_, i) => `$${i + 2}`).join(',');
	await db.execute(`DELETE FROM inventory WHERE act_line_id = $1 AND message_id IN (${placeholders})`, [actLineId, ...messageIds]);
	await db.execute(`DELETE FROM inventory_changes WHERE act_line_id = $1 AND message_id IN (${placeholders})`, [
		actLineId,
		...messageIds,
	]);
}

export async function deleteInventoryByActLine(actLineId: string): Promise<void> {
	const db = getDatabase();
	await db.execute('DELETE FROM inventory WHERE act_line_id = $1', [actLineId]);
	await db.execute('DELETE FROM inventory_changes WHERE act_line_id = $1', [actLineId]);
}

export async function cloneInventory(fromActLineId: string, toActLineId: string): Promise<void> {
	const db = getDatabase();
	const items = await db.select<InventoryRow[]>('SELECT * FROM inventory WHERE act_line_id = $1', [fromActLineId]);
	for (const row of items) {
		await db.execute(
			`INSERT INTO inventory (id, story_id, act_line_id, character_canonical_name, item_name, category, equip_status, description, message_id, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			[crypto.randomUUID(), row.story_id, toActLineId, row.character_canonical_name, row.item_name, row.category, row.equip_status, row.description, row.message_id, row.created_at]
		);
	}
	const changes = await db.select<InventoryChangeRow[]>('SELECT * FROM inventory_changes WHERE act_line_id = $1', [fromActLineId]);
	for (const row of changes) {
		await db.execute(
			`INSERT INTO inventory_changes (id, story_id, act_line_id, character_canonical_name, item_name, change_type, description, message_id, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			[crypto.randomUUID(), row.story_id, toActLineId, row.character_canonical_name, row.item_name, row.change_type, row.description, row.message_id, row.created_at]
		);
	}
}
