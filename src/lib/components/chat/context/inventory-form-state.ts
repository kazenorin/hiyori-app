import type { InventoryCategory, InventoryEventType, EquipStatus } from '#lib/db/inventory.ts';
import type { InventoryEntryDraft } from '#lib/features/inventory-context.ts';

export type InventoryCategoryChoice = 'inherit' | 'none' | InventoryCategory;

export function eventImpliesEquipStatus(eventType: InventoryEventType): boolean {
	return eventType === 'equipped' || eventType === 'unequipped' || eventType === 'lost' || eventType === 'consumed';
}

export function nextCategoryChoice(eventType: InventoryEventType, choice: InventoryCategoryChoice): InventoryCategoryChoice {
	return eventType === 'acquired' && choice === 'inherit' ? 'none' : choice;
}

export function buildInventoryDraft(input: {
	itemName: string;
	eventType: InventoryEventType;
	categoryChoice: InventoryCategoryChoice;
	equipStatus: EquipStatus;
	description: string;
}): InventoryEntryDraft {
	const category = input.categoryChoice === 'inherit' ? undefined : input.categoryChoice === 'none' ? null : input.categoryChoice;
	const trimmedDescription = input.description.trim();
	return {
		itemName: input.itemName,
		eventType: input.eventType,
		category,
		equipStatus: eventImpliesEquipStatus(input.eventType) ? undefined : input.equipStatus,
		description: trimmedDescription.length > 0 ? trimmedDescription : null,
	};
}
