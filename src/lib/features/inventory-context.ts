import { getLastSceneNumber } from '#lib/db/act-lines.ts';
import { toCanonicalName } from '#lib/db/character-profiles.ts';
import {
	EXCLUDED_STATUSES,
	getInventoryRowsUpToScene,
	type EquipStatus,
	type InventoryCategory,
	type InventoryEventType,
	type InventoryRow,
} from '#lib/db/inventory.ts';

export interface InventoryCharacter {
	canonicalName: string;
	aliases: string[];
}

export interface InventoryEntry {
	id: string;
	actLineId: string;
	ownerName: string;
	itemName: string;
	eventType: InventoryEventType;
	category: InventoryCategory | null;
	equipStatus: EquipStatus;
	description: string | null;
	messageId: string;
	sceneNumber: number | null;
	createdAt: string | null;
}

export interface InventoryItem {
	itemName: string;
	ownerName: string;
	category: InventoryCategory | null;
	equipStatus: EquipStatus;
	description: string | null;
	entries: InventoryEntry[];
}

export interface InventoryContext {
	items: InventoryItem[];
	inactiveItems: InventoryItem[];
	editable: boolean;
}

function assertActLineId(actLineId: string): void {
	if (typeof actLineId !== 'string' || actLineId.length === 0) {
		throw new Error('Inventory operation rejected: actLineId must be a non-empty string.');
	}
}

function assertSceneNumber(sceneNumber: number): void {
	if (!Number.isInteger(sceneNumber)) {
		throw new Error(`Inventory operation rejected: sceneNumber must be an integer (got ${String(sceneNumber)}).`);
	}
}

export function inventoryCharacterNames(character: InventoryCharacter): string[] {
	const names = [character.canonicalName, ...character.aliases.map(toCanonicalName)]
		.map((name) => name.trim())
		.filter((name) => name.length > 0);
	return [...new Set(names)];
}

function mapRowToEntry(row: InventoryRow): InventoryEntry {
	return {
		id: row.id,
		actLineId: row.act_line_id,
		ownerName: row.character_canonical_name,
		itemName: row.item_name,
		eventType: row.event_type as InventoryEventType,
		category: row.category as InventoryCategory | null,
		equipStatus: row.equip_status as EquipStatus,
		description: row.description,
		messageId: row.message_id,
		sceneNumber: row.scene_number,
		createdAt: row.created_at,
	};
}

export async function loadInventoryContext(
	actLineId: string,
	character: InventoryCharacter,
	sceneNumber: number
): Promise<InventoryContext> {
	assertActLineId(actLineId);
	assertSceneNumber(sceneNumber);
	const names = inventoryCharacterNames(character);
	const [rows, lastSceneNumber] = await Promise.all([
		getInventoryRowsUpToScene(actLineId, names, sceneNumber),
		getLastSceneNumber(actLineId),
	]);

	const groups = new Map<string, InventoryRow[]>();
	for (const row of rows) {
		const group = groups.get(row.item_name);
		if (group) group.push(row);
		else groups.set(row.item_name, [row]);
	}

	const items: InventoryItem[] = [];
	const inactiveItems: InventoryItem[] = [];
	for (const [itemName, itemRows] of groups) {
		const entries = itemRows.map(mapRowToEntry);
		const latest = entries[entries.length - 1];
		const item: InventoryItem = {
			itemName,
			ownerName: latest.ownerName,
			category: latest.category,
			equipStatus: latest.equipStatus,
			description: latest.description,
			entries,
		};
		if (EXCLUDED_STATUSES.includes(latest.equipStatus)) inactiveItems.push(item);
		else items.push(item);
	}

	const byName = (a: InventoryItem, b: InventoryItem): number => a.itemName.localeCompare(b.itemName);
	items.sort(byName);
	inactiveItems.sort(byName);

	return { items, inactiveItems, editable: lastSceneNumber === sceneNumber };
}
