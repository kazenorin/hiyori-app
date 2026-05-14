export type InventoryCategory = 'item' | 'equipment' | 'skill' | 'clothing' | 'status';

export type EquipStatus = 'equipped' | 'carried' | 'owned' | 'known';

export const INVENTORY_CATEGORIES: readonly InventoryCategory[] = ['item', 'equipment', 'skill', 'clothing', 'status'] as const;

export const EQUIP_STATUSES: readonly EquipStatus[] = ['equipped', 'carried', 'owned', 'known'] as const;

export const INVENTORY_CHANGE_TYPES: readonly InventoryChange['changeType'][] = [
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
	changeType: 'acquired' | 'lost' | 'equipped' | 'unequipped' | 'used' | 'modified';
	description: string | null;
	messageId: string;
	createdAt: string | null;
}

export interface ExtractedInventoryItem {
	name: string;
	category: InventoryCategory;
	equipStatus: EquipStatus;
	description?: string;
}

export interface ExtractedInventoryChange {
	itemName: string;
	changeType: InventoryChange['changeType'];
	description?: string;
}

export interface ExtractedInventory {
	items: ExtractedInventoryItem[];
	changes?: ExtractedInventoryChange[];
}

export function toInventoryItem(row: Record<string, unknown>): InventoryItem {
	return {
		id: String(row.id),
		storyId: String(row.story_id),
		actLineId: String(row.act_line_id),
		characterCanonicalName: String(row.character_canonical_name),
		itemName: String(row.item_name),
		category: String(row.category) as InventoryCategory,
		equipStatus: String(row.equip_status) as EquipStatus,
		description: row.description != null ? String(row.description) : null,
		messageId: String(row.message_id),
		createdAt: row.created_at != null ? String(row.created_at) : null,
	};
}

export function toInventoryChange(row: Record<string, unknown>): InventoryChange {
	return {
		id: String(row.id),
		storyId: String(row.story_id),
		actLineId: String(row.act_line_id),
		characterCanonicalName: String(row.character_canonical_name),
		itemName: String(row.item_name),
		changeType: String(row.change_type) as InventoryChange['changeType'],
		description: row.description != null ? String(row.description) : null,
		messageId: String(row.message_id),
		createdAt: row.created_at != null ? String(row.created_at) : null,
	};
}
