import { tool } from 'ai';
import { z } from 'zod';
import { Memory } from '$lib/memory/memory';
import type { InventoryCategory } from '$lib/memory/inventory-types';
import { getEmbeddingProviderConfig, settings } from '$lib/stores/settings.svelte';
import type { ToolSet } from 'ai';

export interface QueryInventoryContext {
	memory: Memory;
	storyId: string;
	actLineId: string;
}

interface InventoryResult {
	name: string;
	category: InventoryCategory;
	equipStatus: string;
	description: string | null;
}

interface InventoryChangeResult {
	itemName: string;
	changeType: string;
	description: string | null;
}

interface QueryInventoryOutput {
	inventory: InventoryResult[];
	changes?: InventoryChangeResult[];
}

const QUERY_INVENTORY_DESCRIPTION = `Check what a character currently has in their inventory. Returns items, equipment, skills, clothing, and status effects with equip status (equipped/wielded vs carried/owned).

IMPORTANT: Only inventory changes that occur DURING the story are tracked. Items a character possessed before the story began will NOT appear in inventory unless they are explicitly mentioned in a scene. You should use your judgment to infer pre-existing possessions when appropriate (e.g., a knight likely has armor even if not explicitly mentioned, a wizard likely knows basic spells).

Use this tool before describing a character using an item or ability to ensure consistency.

Set includeHistory to true to also see the log of inventory change events (acquired, lost, equipped, unequipped, used, modified) for the character.`;

const QUERY_INVENTORY_PARAMS = {
	characterName: {
		description: "The character's name (canonical name or alias)",
	},
	itemCategory: {
		description: 'Optional filter to return only one category',
	},
	includeHistory: {
		description: 'If true, also return the inventory change event history for this character',
	},
} as const;

export function createQueryInventoryTool(context: QueryInventoryContext) {
	const { memory, storyId, actLineId } = context;

	const inputSchema = z.object({
		characterName: z.string().describe(QUERY_INVENTORY_PARAMS.characterName.description),
		itemCategory: z
			.enum(['item', 'equipment', 'skill', 'clothing', 'status'])
			.optional()
			.describe(QUERY_INVENTORY_PARAMS.itemCategory.description),
		includeHistory: z.boolean().optional().describe(QUERY_INVENTORY_PARAMS.includeHistory.description),
	});

	return tool({
		description: QUERY_INVENTORY_DESCRIPTION,
		inputSchema,
		execute: async (input: z.infer<typeof inputSchema>): Promise<QueryInventoryOutput> => {
			const { characterName, itemCategory, includeHistory } = input;

			// Resolve aliases to find all names for the character
			const resolvedNames = await memory.resolveAliases(storyId, actLineId, characterName);

			// Query inventory for all resolved names and combine results
			const allItems: InventoryResult[] = [];
			for (const name of resolvedNames) {
				const items = await memory.getInventory(name, {
					storyId,
					actLineId,
					category: itemCategory as InventoryCategory | undefined,
				});
				allItems.push(
					...items.map((item) => ({
						name: item.itemName,
						category: item.category,
						equipStatus: item.equipStatus,
						description: item.description,
					}))
				);
			}

			const output: QueryInventoryOutput = { inventory: allItems };

			// Include change history if requested
			if (includeHistory) {
				const allChanges: InventoryChangeResult[] = [];
				for (const name of resolvedNames) {
					const changes = await memory.getInventoryChanges(name, { storyId, actLineId });
					allChanges.push(
						...changes.map((change) => ({
							itemName: change.itemName,
							changeType: change.changeType,
							description: change.description,
						}))
					);
				}
				output.changes = allChanges;
			}

			return output;
		},
	});
}

export function buildInventoryTools(storyId: string | null, actLineId: string): ToolSet {
	if (!settings.memoryEnabled) return {};
	if (!storyId || !actLineId) return {};

	const memConfig = getEmbeddingProviderConfig();
	if (!memConfig) return {};

	return {
		'query-inventory': createQueryInventoryTool({
			memory: new Memory(memConfig),
			storyId,
			actLineId,
		}),
	};
}
