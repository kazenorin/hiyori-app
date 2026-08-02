import { ls } from '$lib/localization';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolSet } from 'ai';
import type { ToolContext } from './tools';
import { log } from './utils';
import {
	appendInventoryEvents,
	INVENTORY_CATEGORIES,
	EQUIP_STATUSES,
	INVENTORY_EVENT_TYPES,
	type InventoryCategory,
	type EquipStatus,
	type InventoryEventType,
} from '$lib/db/inventory';

export interface UpdateInventoryContext extends ToolContext {
	messageId: string;
}

export function createUpdateInventoryTool(ctx: UpdateInventoryContext) {
	const { story, actLine, messageId } = ctx;

	const eventSchema = z.object({
		itemName: z.string().min(1).describe(ls('tools.updateInventory.parameters.itemName')),
		eventType: z.enum(INVENTORY_EVENT_TYPES).describe(ls('tools.updateInventory.parameters.eventType')),
		category: z.enum(INVENTORY_CATEGORIES).optional().describe(ls('tools.updateInventory.parameters.category')),
		equipStatus: z.enum(EQUIP_STATUSES).optional().describe(ls('tools.updateInventory.parameters.equipStatus')),
		description: z.string().optional().describe(ls('tools.updateInventory.parameters.description')),
	});

	const inputSchema = z.object({
		characterName: z.string().min(1).describe(ls('tools.updateInventory.parameters.characterName')),
		events: z.array(eventSchema).min(1).describe(ls('tools.updateInventory.parameters.events')),
	});

	return tool({
		description: ls('tools.updateInventory.description'),
		inputSchema,
		execute: async (input): Promise<string> => {
			const { characterName, events } = input;
			await log(`update-inventory triggered: character=${characterName}, events=${events.length}`);

			await appendInventoryEvents(
				story.id,
				actLine.id,
				messageId,
				actLine.currentScene,
				events.map((e) => ({
					characterName,
					itemName: e.itemName,
					eventType: e.eventType as InventoryEventType,
					category: e.category as InventoryCategory | undefined,
					equipStatus: e.equipStatus as EquipStatus | undefined,
					description: e.description,
				}))
			);

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
