import { ls } from '$lib/localization';
import { tool } from 'ai';
import { z } from 'zod';
import {
	getLatestPerItem,
	getInventoryEvents,
	resolveCharacterNames,
	type InventoryCategory,
	type EquipStatus,
	type InventoryEventType,
} from '$lib/db/inventory';
import { traceActLineChain } from '$lib/db/acts';
import { isInventoryAvailable } from '$lib/stores/settings.svelte';
import type { ToolSet } from 'ai';
import { log } from './utils';

export interface QueryInventoryContext {
	storyId: string;
	actLineId: string;
	actNumber: number;
}

interface InventoryResult {
	name: string;
	category: InventoryCategory | null;
	equipStatus: EquipStatus;
	description: string | null;
}

interface InventoryEventResult {
	itemName: string;
	eventType: InventoryEventType;
	description: string | null;
	sceneNumber: number | null;
}

interface QueryInventoryOutput {
	inventory: InventoryResult[];
	events?: InventoryEventResult[];
}

export function createQueryInventoryTool(context: QueryInventoryContext) {
	const { storyId, actLineId, actNumber } = context;

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
			await log(
				`query-inventory triggered: character=${characterName}, category=${itemCategory ?? 'all'}, includeHistory=${includeHistory}`
			);

			const chain = actNumber > 1 ? await traceActLineChain(actLineId, true) : [{ actLineId }];
			const resolvedNames = await resolveCharacterNames(actLineId, characterName, chain);

			const seen = new Map<string, InventoryResult>();
			for (const link of chain) {
				const items = await getLatestPerItem(link.actLineId, resolvedNames, itemCategory as InventoryCategory | undefined);
				for (const item of items) {
					if (!seen.has(item.itemName)) {
						seen.set(item.itemName, {
							name: item.itemName,
							category: item.category,
							equipStatus: item.equipStatus,
							description: item.description,
						});
					}
				}
			}

			const output: QueryInventoryOutput = { inventory: [...seen.values()] };

			if (includeHistory) {
				const actLineIds = chain.map((l) => l.actLineId);
				const events = await getInventoryEvents(resolvedNames, { storyId, actLineIds });
				output.events = events.map((e) => ({
					itemName: e.itemName,
					eventType: e.eventType,
					description: e.description,
					sceneNumber: e.sceneNumber,
				}));
			}

			return output;
		},
	});
}

export function buildInventoryTools(storyId: string | null, actLineId: string, actNumber: number): ToolSet {
	if (!isInventoryAvailable()) return {};
	if (!storyId || !actLineId) return {};

	return {
		'query-inventory': createQueryInventoryTool({ storyId, actLineId, actNumber }),
	};
}
