import { ls } from '$lib/localization';
import { tool } from 'ai';
import { z } from 'zod';
import { Memory } from '$lib/features/memory';
import type { InventoryCategory } from '$lib/features/memory/inventory-types';
import { traceActLineChain } from '$lib/db/act-lines';
import { getEmbeddingProviderConfig, settings } from '$lib/stores/settings.svelte';
import type { ToolSet } from 'ai';
import { log } from './utils';

export interface QueryInventoryContext {
	memory: Memory;
	storyId: string;
	actLineId: string;
	actNumber: number;
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

export function createQueryInventoryTool(context: QueryInventoryContext) {
	const { memory, storyId, actLineId, actNumber } = context;

	const inputSchema = z.object({
		characterName: z.string().describe(ls('tools.queryInventory.parameters.characterName')),
		itemCategory: z
			.enum(['item', 'equipment', 'skill', 'clothing', 'status'])
			.optional()
			.describe(ls('tools.queryInventory.parameters.itemCategory')),
		includeHistory: z.boolean().optional().describe(ls('tools.queryInventory.parameters.includeHistory')),
	});

	return tool({
		description: ls('tools.queryInventory.description'),
		inputSchema,
		execute: async (input: z.infer<typeof inputSchema>): Promise<QueryInventoryOutput> => {
			const { characterName, itemCategory, includeHistory } = input;
			await log(`query-inventory triggered: character=${characterName}, category=${itemCategory ?? 'all'}, includeHistory=${includeHistory}`);

			const actLineIds = actNumber > 1
				? (await traceActLineChain(actLineId)).map((l) => l.actLineId)
				: [actLineId];

			const resolvedNames = await memory.resolveAliases(storyId, actLineIds, characterName);

			const allItems: InventoryResult[] = [];
			for (const name of resolvedNames) {
				const items = await memory.getInventory(name, {
					storyId,
					actLineIds,
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

			if (includeHistory) {
				const allChanges: InventoryChangeResult[] = [];
				for (const name of resolvedNames) {
					const changes = await memory.getInventoryChanges(name, { storyId, actLineIds });
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

export function buildInventoryTools(storyId: string | null, actLineId: string, actNumber: number): ToolSet {
	if (!settings.memoryEnabled) return {};
	if (!storyId || !actLineId) return {};

	const memConfig = getEmbeddingProviderConfig();
	if (!memConfig) return {};

	return {
		'query-inventory': createQueryInventoryTool({
			memory: new Memory(memConfig),
			storyId,
			actLineId,
			actNumber,
		}),
	};
}
