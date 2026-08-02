import { ls } from '$lib/localization';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolSet } from 'ai';
import type { ToolContext } from './tools';
import { log } from './utils';
import {
	upsertInventoryItems,
	insertInventoryChanges,
	INVENTORY_CATEGORIES,
	EQUIP_STATUSES,
	INVENTORY_CHANGE_TYPES,
	type InventoryCategory,
	type EquipStatus,
	type InventoryChangeType,
} from '$lib/db/inventory';

export interface UpdateInventoryContext extends ToolContext {
	messageId: string;
}

export function createUpdateInventoryTool(ctx: UpdateInventoryContext) {
	const { story, actLine, messageId } = ctx;

	const itemSchema = z.object({
		itemName: z.string().min(1).describe(ls('tools.updateInventory.parameters.itemName')),
		category: z.enum(INVENTORY_CATEGORIES).describe(ls('tools.updateInventory.parameters.category')),
		equipStatus: z.enum(EQUIP_STATUSES).optional().default('carried').describe(ls('tools.updateInventory.parameters.equipStatus')),
		description: z.string().optional().describe(ls('tools.updateInventory.parameters.itemDescription')),
	});

	const changeSchema = z.object({
		itemName: z.string().min(1).describe(ls('tools.updateInventory.parameters.itemName')),
		changeType: z.enum(INVENTORY_CHANGE_TYPES).describe(ls('tools.updateInventory.parameters.changeType')),
		description: z.string().optional().describe(ls('tools.updateInventory.parameters.changeDescription')),
	});

	const inputSchema = z.object({
		characterName: z.string().min(1).describe(ls('tools.updateInventory.parameters.characterName')),
		items: z.array(itemSchema).optional().describe(ls('tools.updateInventory.parameters.items')),
		changes: z.array(changeSchema).optional().describe(ls('tools.updateInventory.parameters.changes')),
	});

	return tool({
		description: ls('tools.updateInventory.description'),
		inputSchema,
		execute: async (input): Promise<string> => {
			const { characterName, items = [], changes = [] } = input;
			await log(`update-inventory triggered: character=${characterName}, items=${items.length}, changes=${changes.length}`);

			if (items.length === 0 && changes.length === 0) {
				return ls('tools.updateInventory.messages.empty');
			}

			if (items.length > 0) {
				await upsertInventoryItems(
					story.id,
					actLine.id,
					messageId,
					items.map((i) => ({
						characterName,
						itemName: i.itemName,
						category: i.category as InventoryCategory,
						equipStatus: i.equipStatus as EquipStatus,
						description: i.description,
					}))
				);
			}

			if (changes.length > 0) {
				await insertInventoryChanges(
					story.id,
					actLine.id,
					messageId,
					changes.map((c) => ({
						characterName,
						itemName: c.itemName,
						changeType: c.changeType as InventoryChangeType,
						description: c.description,
					}))
				);
			}

			await log(`update-inventory persisted for ${characterName}`);
			return `Inventory updated for ${characterName}.`;
		},
	});
}

export function buildUpdateInventoryTools(ctx: UpdateInventoryContext): ToolSet {
	return {
		'update-inventory': createUpdateInventoryTool(ctx),
	};
}
