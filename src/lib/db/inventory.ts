import { getDatabase } from './database';
import { getLatestProfileByAlias, toCanonicalName } from './character-profiles';
import { traceActLineChain } from './acts';

export type InventoryCategory = 'item' | 'equipment' | 'skill' | 'clothing' | 'status';

export type EquipStatus = 'equipped' | 'carried' | 'owned' | 'known';

export type InventoryEventType = 'acquired' | 'lost' | 'equipped' | 'unequipped' | 'used' | 'modified';

export const INVENTORY_CATEGORIES: readonly InventoryCategory[] = ['item', 'equipment', 'skill', 'clothing', 'status'] as const;

export const EQUIP_STATUSES: readonly EquipStatus[] = ['equipped', 'carried', 'owned', 'known'] as const;

export const INVENTORY_EVENT_TYPES: readonly InventoryEventType[] = [
	'acquired',
	'lost',
	'equipped',
	'unequipped',
	'used',
	'modified',
] as const;

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
	equip_status: string | null;
	description: string | null;
	created_at: string | null;
}

export interface InventoryItem {
	itemName: string;
	category: string | null;
	equipStatus: string | null;
	description: string | null;
	eventType: string;
	messageId: string;
	sceneNumber: number | null;
}

export interface InventoryEvent {
	itemName: string;
	eventType: string;
	description: string | null;
	messageId: string;
	sceneNumber: number | null;
	createdAt: string | null;
}

export interface AppendInventoryEventInput {
	characterName: string;
	itemName: string;
	eventType: InventoryEventType;
	category?: InventoryCategory;
	equipStatus?: EquipStatus;
	description?: string;
}

function mapRowToItem(row: InventoryRow): InventoryItem {
	return {
		itemName: row.item_name,
		category: row.category,
		equipStatus: row.equip_status,
		description: row.description,
		eventType: row.event_type,
		messageId: row.message_id,
		sceneNumber: row.scene_number,
	};
}

function mapRowToEvent(row: InventoryRow): InventoryEvent {
	return {
		itemName: row.item_name,
		eventType: row.event_type,
		description: row.description,
		messageId: row.message_id,
		sceneNumber: row.scene_number,
		createdAt: row.created_at,
	};
}

export async function appendInventoryEvents(
	storyId: string,
	actLineId: string,
	messageId: string,
	sceneNumber: number | null,
	events: AppendInventoryEventInput[]
): Promise<void> {
	const db = getDatabase();
	for (const event of events) {
		const canonical = toCanonicalName(event.characterName);

		let category: string | null = event.category ?? null;
		let equipStatus: string | null = event.equipStatus ?? null;

		if (event.eventType !== 'acquired') {
			const prior = await getLatestRowForItem(actLineId, canonical, event.itemName);
			if (prior) {
				category = category ?? prior.category;
				equipStatus = equipStatus ?? prior.equip_status;
			}
		}

		if (event.eventType === 'equipped') {
			equipStatus = 'equipped';
		} else if (event.eventType === 'unequipped') {
			equipStatus = 'carried';
		}

		if (event.eventType === 'acquired' && !equipStatus) {
			equipStatus = 'carried';
		}

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

async function getLatestRowForItem(
	actLineId: string,
	characterCanonicalName: string,
	itemName: string
): Promise<InventoryRow | null> {
	const db = getDatabase();
	const rows = await db.select<InventoryRow[]>(
		`SELECT * FROM inventory
		 WHERE act_line_id = $1 AND character_canonical_name = $2 AND item_name = $3
		 ORDER BY created_at DESC LIMIT 1`,
		[actLineId, characterCanonicalName, itemName]
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
	let query = `SELECT * FROM inventory WHERE act_line_id = $1 AND character_canonical_name IN (${namePlaceholders})`;
	const params: (string | number)[] = [actLineId, ...characterNames];
	if (category) {
		params.push(category);
		query += ` AND category = $${params.length}`;
	}
	query += ' ORDER BY created_at ASC';

	const rows = await db.select<InventoryRow[]>(query, params);

	const seen = new Map<string, InventoryRow>();
	for (const row of rows) {
		seen.set(row.item_name, row);
	}

	return [...seen.values()].filter((r) => r.event_type !== 'lost').map(mapRowToItem);
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
		 ORDER BY created_at ASC`,
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
	await db.execute(`DELETE FROM inventory WHERE act_line_id = $1 AND message_id IN (${placeholders})`, [
		actLineId,
		...messageIds,
	]);
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
