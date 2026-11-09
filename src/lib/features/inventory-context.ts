import { getLastSceneNumber } from '#lib/db/act-lines.ts';
import { toCanonicalName } from '#lib/db/character-profiles.ts';
import {
	appendInventoryEvents,
	deleteInventoryItemHistory,
	deleteInventoryRow,
	getInventoryRowsUpToScene,
	resolveEquipStatus,
	updateInventoryRow,
	EQUIP_STATUSES,
	EXCLUDED_STATUSES,
	INVENTORY_CATEGORIES,
	INVENTORY_EVENT_TYPES,
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

export class DuplicateInventoryItemError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DuplicateInventoryItemError';
	}
}

export interface InventoryEntryDraft {
	itemName: string;
	eventType: InventoryEventType;
	category: InventoryCategory | null | undefined;
	equipStatus?: EquipStatus;
	description: string | null;
}

function normalizeEventType(value: unknown): InventoryEventType {
	if (typeof value !== 'string' || !INVENTORY_EVENT_TYPES.includes(value as InventoryEventType)) {
		throw new Error(`Inventory entry rejected: unknown event type "${String(value)}".`);
	}
	return value as InventoryEventType;
}

function normalizeCategory(value: unknown): InventoryCategory | null {
	if (value === null) return null;
	if (typeof value !== 'string' || !INVENTORY_CATEGORIES.includes(value as InventoryCategory)) {
		throw new Error(`Inventory entry rejected: unknown category "${String(value)}".`);
	}
	return value as InventoryCategory;
}

function requiredCategory(value: unknown, context: string): InventoryCategory | null {
	if (value === undefined) throw new Error(`${context} requires an explicit category or null.`);
	return normalizeCategory(value);
}

function normalizeEquipStatus(value: unknown): EquipStatus | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || !EQUIP_STATUSES.includes(value as EquipStatus)) {
		throw new Error(`Inventory entry rejected: unknown equip status "${String(value)}".`);
	}
	return value as EquipStatus;
}

function normalizeDescription(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'string') throw new Error('Inventory entry description must be a string or null.');
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function normalizeAddDraft(
	draft: InventoryEntryDraft,
	mode: 'item' | 'entry'
): {
	itemName: string;
	eventType: InventoryEventType;
	category: InventoryCategory | null | undefined;
	equipStatus?: EquipStatus;
	description: string | null;
} {
	if (!draft || typeof draft !== 'object') throw new Error('Inventory entry draft must be an object.');
	const eventType = normalizeEventType(draft.eventType);
	if (typeof draft.itemName !== 'string') throw new Error('Inventory entry item name must be a string.');
	const itemName = mode === 'item' ? draft.itemName.trim() : draft.itemName;
	if (itemName.length === 0) throw new Error('Inventory entry item name must not be empty.');
	const needsExplicitCategory = mode === 'item' || eventType === 'acquired';
	const category = needsExplicitCategory
		? requiredCategory(draft.category, 'Add item and acquired Add entry')
		: draft.category === undefined
			? undefined
			: normalizeCategory(draft.category);
	return {
		itemName,
		eventType,
		category,
		equipStatus: normalizeEquipStatus(draft.equipStatus),
		description: normalizeDescription(draft.description),
	};
}

async function assertLatestScene(actLineId: string, sceneNumber: number): Promise<void> {
	const lastSceneNumber = await getLastSceneNumber(actLineId);
	if (lastSceneNumber !== sceneNumber) {
		throw new Error(
			`Inventory operation rejected: the selected scene ${sceneNumber} is not the latest scene (${String(lastSceneNumber)}) of the act line.`
		);
	}
}

function assertEntryEligible(actLineId: string, sceneNumber: number, entry: InventoryEntry): void {
	if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || entry.id.length === 0) {
		throw new Error('Inventory operation rejected: the observed entry is required.');
	}
	if (entry.actLineId !== actLineId) {
		throw new Error(`Inventory operation rejected: entry "${entry.id}" belongs to another act line.`);
	}
	if (entry.sceneNumber !== sceneNumber) {
		throw new Error(`Inventory operation rejected: entry "${entry.id}" does not belong to the selected scene.`);
	}
}

export async function addInventoryEntry(
	storyId: string,
	actLineId: string,
	messageId: string,
	sceneNumber: number,
	character: InventoryCharacter,
	draft: InventoryEntryDraft,
	mode: 'item' | 'entry',
	ownerName?: string
): Promise<void> {
	assertActLineId(actLineId);
	assertSceneNumber(sceneNumber);
	await assertLatestScene(actLineId, sceneNumber);
	const normalized = normalizeAddDraft(draft, mode);
	const names = inventoryCharacterNames(character);

	let writeName: string;
	if (mode === 'item') {
		const existing = await getInventoryRowsUpToScene(actLineId, names, sceneNumber);
		if (existing.some((row) => row.item_name === normalized.itemName)) {
			throw new DuplicateInventoryItemError(
				`Inventory item "${normalized.itemName}" already exists; add an entry to it instead of adding a new item.`
			);
		}
		writeName = character.canonicalName;
	} else {
		if (typeof ownerName !== 'string' || ownerName.length === 0) {
			throw new Error('Inventory entry rejected: the owning canonical name is required.');
		}
		writeName = ownerName;
	}

	await appendInventoryEvents(
		storyId,
		actLineId,
		messageId,
		sceneNumber,
		[
			{
				characterName: writeName,
				itemName: normalized.itemName,
				eventType: normalized.eventType,
				category: normalized.category,
				equipStatus: normalized.equipStatus,
				description: normalized.description ?? undefined,
			},
		],
		{ priorNames: names }
	);
}

export async function updateInventoryEntry(
	actLineId: string,
	sceneNumber: number,
	entry: InventoryEntry,
	draft: InventoryEntryDraft
): Promise<void> {
	assertActLineId(actLineId);
	assertSceneNumber(sceneNumber);
	await assertLatestScene(actLineId, sceneNumber);
	assertEntryEligible(actLineId, sceneNumber, entry);
	if (!draft || typeof draft !== 'object') throw new Error('Inventory entry draft must be an object.');

	const eventType = normalizeEventType(draft.eventType);
	const category = requiredCategory(draft.category, 'Edit entry');
	const equipStatus = resolveEquipStatus(eventType, normalizeEquipStatus(draft.equipStatus), entry.equipStatus);
	const affected = await updateInventoryRow(entry.id, actLineId, {
		eventType,
		category,
		equipStatus,
		description: normalizeDescription(draft.description),
	});
	if (affected !== 1) {
		throw new Error(`Inventory operation rejected: entry "${entry.id}" is stale and was not updated.`);
	}
}

export async function removeInventoryEntry(
	actLineId: string,
	sceneNumber: number,
	character: InventoryCharacter,
	entry: InventoryEntry,
	mode: 'entry' | 'history'
): Promise<void> {
	assertActLineId(actLineId);
	assertSceneNumber(sceneNumber);
	if (mode !== 'entry' && mode !== 'history') {
		throw new Error(`Inventory removal mode must be "entry" or "history" (got ${String(mode)}).`);
	}
	await assertLatestScene(actLineId, sceneNumber);
	if (!entry || typeof entry !== 'object' || typeof entry.actLineId !== 'string' || entry.actLineId.length === 0) {
		throw new Error('Inventory removal rejected: the observed entry is required.');
	}
	if (entry.actLineId !== actLineId) {
		throw new Error(`Inventory removal rejected: entry "${entry.id}" belongs to another act line.`);
	}

	if (mode === 'entry') {
		assertEntryEligible(actLineId, sceneNumber, entry);
		const affected = await deleteInventoryRow(entry.id, actLineId);
		if (affected !== 1) {
			throw new Error(`Inventory operation rejected: entry "${entry.id}" is stale and was not deleted.`);
		}
		return;
	}

	const names = inventoryCharacterNames(character);
	const affected = await deleteInventoryItemHistory(actLineId, names, entry.itemName);
	if (affected < 1) {
		throw new Error(`Inventory operation rejected: no rows were found for item "${entry.itemName}".`);
	}
}
