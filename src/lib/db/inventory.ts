import { getDatabase } from './database';
import { getLatestProfileByAlias, toCanonicalName } from './character-profiles';
import { traceActLineChain } from './acts';

export type InventoryCategory = 'item' | 'equipment' | 'skill' | 'clothing' | 'status';

export type EquipStatus = 'equipped' | 'unequipped' | 'carried' | 'owned' | 'known' | 'lost' | 'consumed';

export type InventoryEventType = 'acquired' | 'lost' | 'consumed' | 'equipped' | 'unequipped' | 'used' | 'modified';

export const INVENTORY_CATEGORIES: readonly InventoryCategory[] = ['item', 'equipment', 'skill', 'clothing', 'status'] as const;

export const EQUIP_STATUSES: readonly EquipStatus[] = ['equipped', 'unequipped', 'carried', 'owned', 'known', 'lost', 'consumed'] as const;

export const INVENTORY_EVENT_TYPES: readonly InventoryEventType[] = [
	'acquired',
	'lost',
	'consumed',
	'equipped',
	'unequipped',
	'used',
	'modified',
] as const;

/** Statuses that mean the character no longer has the item. */
export const EXCLUDED_STATUSES: readonly EquipStatus[] = ['lost', 'consumed'];

export interface InventoryRow {
	id: string;
	story_id: string;
	act_line_id: string;
	message_id: string;
	scene_number: number | null;
	character_canonical_name: string;
	item_name: string;
	event_type: string;
	category: string | null;
	equip_status: string;
	description: string | null;
	created_at: string | null;
}

export interface InventoryItem {
	itemName: string;
	category: InventoryCategory | null;
	equipStatus: EquipStatus;
	description: string | null;
	eventType: InventoryEventType;
	messageId: string;
	sceneNumber: number | null;
}

export interface InventoryEvent {
	itemName: string;
	eventType: InventoryEventType;
	description: string | null;
	messageId: string;
	sceneNumber: number | null;
	createdAt: string | null;
}

export interface AppendInventoryEventInput {
	characterName: string;
	itemName: string;
	eventType: InventoryEventType;
	category?: InventoryCategory | null;
	equipStatus?: EquipStatus;
	description?: string;
}

function mapRowToItem(row: InventoryRow): InventoryItem {
	return {
		itemName: row.item_name,
		category: row.category as InventoryCategory | null,
		equipStatus: row.equip_status as EquipStatus,
		description: row.description,
		eventType: row.event_type as InventoryEventType,
		messageId: row.message_id,
		sceneNumber: row.scene_number,
	};
}

function mapRowToEvent(row: InventoryRow): InventoryEvent {
	return {
		itemName: row.item_name,
		eventType: row.event_type as InventoryEventType,
		description: row.description,
		messageId: row.message_id,
		sceneNumber: row.scene_number,
		createdAt: row.created_at,
	};
}

export function resolveEquipStatus(
	eventType: InventoryEventType,
	requested: EquipStatus | undefined,
	prior: EquipStatus | undefined
): EquipStatus {
	switch (eventType) {
		case 'equipped':
			return 'equipped';
		case 'unequipped':
			return 'unequipped';
		case 'lost':
			return 'lost';
		case 'consumed':
			return 'consumed';
		case 'acquired':
			return requested ?? 'carried';
		default:
			return requested ?? prior ?? 'carried';
	}
}

export async function appendInventoryEvents(
	storyId: string,
	actLineId: string,
	messageId: string,
	sceneNumber: number | null,
	events: AppendInventoryEventInput[],
	options: { priorNames?: string[] } = {}
): Promise<void> {
	const db = getDatabase();
	for (const event of events) {
		const canonical = toCanonicalName(event.characterName);
		const priorNames = options.priorNames && options.priorNames.length > 0 ? options.priorNames : [canonical];

		let category: InventoryCategory | null = event.category ?? null;
		let priorEquipStatus: EquipStatus | undefined;

		if (event.eventType !== 'acquired') {
			const prior = await getLatestRowForItem(actLineId, priorNames, event.itemName);
			if (prior) {
				if (event.category === undefined) category = prior.category as InventoryCategory | null;
				priorEquipStatus = prior.equip_status as EquipStatus;
			}
		}

		const equipStatus = resolveEquipStatus(event.eventType, event.equipStatus, priorEquipStatus);

		await db.execute(
			`INSERT INTO inventory (id, story_id, act_line_id, message_id, scene_number, character_canonical_name, item_name, event_type, category, equip_status, description)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
			[
				crypto.randomUUID(),
				storyId,
				actLineId,
				messageId,
				sceneNumber,
				canonical,
				event.itemName,
				event.eventType,
				category,
				equipStatus,
				event.description ?? null,
			]
		);
	}
}

async function getLatestRowForItem(actLineId: string, characterCanonicalNames: string[], itemName: string): Promise<InventoryRow | null> {
	const db = getDatabase();
	const namePlaceholders = characterCanonicalNames.map((_, i) => `$${i + 2}`).join(',');
	const itemPlaceholder = `$${characterCanonicalNames.length + 2}`;
	const rows = await db.select<InventoryRow[]>(
		`SELECT * FROM inventory
		 WHERE act_line_id = $1 AND character_canonical_name IN (${namePlaceholders}) AND item_name = ${itemPlaceholder}
		 ORDER BY COALESCE(scene_number, -1) DESC, rowid DESC LIMIT 1`,
		[actLineId, ...characterCanonicalNames, itemName]
	);
	return rows.length > 0 ? rows[0] : null;
}

export async function getLatestPerItem(
	actLineId: string,
	characterNames: string[],
	category?: InventoryCategory
): Promise<InventoryItem[]> {
	const db = getDatabase();
	const namePlaceholders = characterNames.map((_, i) => `$${i + 2}`).join(',');
	const query = `SELECT * FROM inventory WHERE act_line_id = $1 AND character_canonical_name IN (${namePlaceholders})
	 ORDER BY COALESCE(scene_number, -1) ASC, rowid ASC`;
	const rows = await db.select<InventoryRow[]>(query, [actLineId, ...characterNames]);

	const seen = new Map<string, InventoryRow>();
	for (const row of rows) {
		seen.set(row.item_name, row);
	}

	return [...seen.values()]
		.filter((r) => !EXCLUDED_STATUSES.includes(r.equip_status as EquipStatus))
		.filter((r) => !category || r.category === category)
		.map(mapRowToItem);
}

export async function getInventoryEvents(
	characterNames: string[],
	opts: { storyId: string; actLineIds: string[] }
): Promise<InventoryEvent[]> {
	const db = getDatabase();
	const linePlaceholders = opts.actLineIds.map((_, i) => `$${i + 3}`).join(',');
	const namePlaceholders = characterNames.map((_, i) => `$${i + 3 + opts.actLineIds.length}`).join(',');
	const rows = await db.select<InventoryRow[]>(
		`SELECT * FROM inventory
		 WHERE story_id = $1 AND act_line_id IN (${linePlaceholders}) AND character_canonical_name IN (${namePlaceholders})
		 ORDER BY COALESCE(scene_number, -1) ASC, rowid ASC`,
		[opts.storyId, ...opts.actLineIds, ...characterNames]
	);

	const seen = new Set<string>();
	const events: InventoryEvent[] = [];
	for (const row of rows) {
		const key = `${row.message_id}|${row.item_name}|${row.event_type}`;
		if (!seen.has(key)) {
			seen.add(key);
			events.push(mapRowToEvent(row));
		}
	}
	return events;
}

export async function resolveCharacterNames(actLineId: string, name: string, chain?: { actLineId: string }[]): Promise<string[]> {
	const canonical = toCanonicalName(name);
	const resolvedChain = chain ?? (await traceActLineChain(actLineId, true));
	for (const link of resolvedChain) {
		const profile = await getLatestProfileByAlias(link.actLineId, name);
		if (profile) {
			return [profile.canonicalName, canonical, ...profile.aliases.map(toCanonicalName)].filter((v, i, a) => a.indexOf(v) === i);
		}
	}
	return [canonical];
}

export async function deleteInventoryByMessages(actLineId: string, messageIds: string[]): Promise<void> {
	const db = getDatabase();
	const placeholders = messageIds.map((_, i) => `$${i + 2}`).join(',');
	await db.execute(`DELETE FROM inventory WHERE act_line_id = $1 AND message_id IN (${placeholders})`, [actLineId, ...messageIds]);
}

export async function getInventoryRowsForActLines(actLineIds: string[]): Promise<InventoryRow[]> {
	if (actLineIds.length === 0) return [];
	const db = getDatabase();
	const placeholders = actLineIds.map((_, i) => `$${i + 1}`).join(',');
	return db.select<InventoryRow[]>(
		`SELECT * FROM inventory WHERE act_line_id IN (${placeholders}) ORDER BY COALESCE(scene_number, -1) ASC, rowid ASC`,
		actLineIds
	);
}

/** A complete inventory row for archive import; ids and timestamps are preserved as exported. */
export interface InsertInventoryRowInput {
	id: string;
	storyId: string;
	actLineId: string;
	messageId: string;
	sceneNumber: number | null;
	characterCanonicalName: string;
	itemName: string;
	eventType: string;
	category: string | null;
	equipStatus: string;
	description: string | null;
	createdAt: string | null;
}

export async function insertInventoryRows(rows: InsertInventoryRowInput[]): Promise<void> {
	const db = getDatabase();
	for (const row of rows) {
		await db.execute(
			`INSERT INTO inventory (id, story_id, act_line_id, message_id, scene_number, character_canonical_name, item_name, event_type, category, equip_status, description, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
			[
				row.id,
				row.storyId,
				row.actLineId,
				row.messageId,
				row.sceneNumber,
				row.characterCanonicalName,
				row.itemName,
				row.eventType,
				row.category,
				row.equipStatus,
				row.description,
				row.createdAt,
			]
		);
	}
}

export async function cloneInventory(fromActLineId: string, toActLineId: string): Promise<void> {
	const db = getDatabase();
	const rows = await db.select<InventoryRow[]>('SELECT * FROM inventory WHERE act_line_id = $1', [fromActLineId]);
	for (const row of rows) {
		await db.execute(
			`INSERT INTO inventory (id, story_id, act_line_id, message_id, scene_number, character_canonical_name, item_name, event_type, category, equip_status, description, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
			[
				crypto.randomUUID(),
				row.story_id,
				toActLineId,
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
}

export async function getInventoryRowsUpToScene(
	actLineId: string,
	characterCanonicalNames: string[],
	sceneNumber: number
): Promise<InventoryRow[]> {
	if (characterCanonicalNames.length === 0) return [];
	const db = getDatabase();
	const namePlaceholders = characterCanonicalNames.map((_, i) => `$${i + 2}`).join(',');
	const scenePlaceholder = `$${characterCanonicalNames.length + 2}`;
	return db.select<InventoryRow[]>(
		`SELECT * FROM inventory
		 WHERE act_line_id = $1
		   AND character_canonical_name IN (${namePlaceholders})
		   AND (scene_number IS NULL OR scene_number <= ${scenePlaceholder})
		 ORDER BY COALESCE(scene_number, -1) ASC, rowid ASC`,
		[actLineId, ...characterCanonicalNames, sceneNumber]
	);
}

export async function updateInventoryRow(
	id: string,
	actLineId: string,
	fields: { eventType: InventoryEventType; category: InventoryCategory | null; equipStatus: EquipStatus; description: string | null }
): Promise<number> {
	const db = getDatabase();
	const result = await db.execute(
		'UPDATE inventory SET event_type = $3, category = $4, equip_status = $5, description = $6 WHERE id = $1 AND act_line_id = $2',
		[id, actLineId, fields.eventType, fields.category, fields.equipStatus, fields.description]
	);
	return result.rowsAffected;
}

export async function deleteInventoryRow(id: string, actLineId: string): Promise<number> {
	const db = getDatabase();
	const result = await db.execute('DELETE FROM inventory WHERE id = $1 AND act_line_id = $2', [id, actLineId]);
	return result.rowsAffected;
}

export async function deleteInventoryItemHistory(actLineId: string, characterCanonicalNames: string[], itemName: string): Promise<number> {
	if (characterCanonicalNames.length === 0) return 0;
	const db = getDatabase();
	const namePlaceholders = characterCanonicalNames.map((_, i) => `$${i + 2}`).join(',');
	const itemPlaceholder = `$${characterCanonicalNames.length + 2}`;
	const result = await db.execute(
		`DELETE FROM inventory
		 WHERE act_line_id = $1 AND character_canonical_name IN (${namePlaceholders}) AND item_name = ${itemPlaceholder}`,
		[actLineId, ...characterCanonicalNames, itemName]
	);
	return result.rowsAffected;
}
