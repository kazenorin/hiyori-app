import { tool } from 'ai';
import { z } from 'zod';
import { sampleSize } from 'lodash-es';
import { Memory, type MemoryItem } from '$lib/memory/memory';
import { batchResolveActLineInfo } from '$lib/db/act-lines';
import { fileLog } from '$lib/logging/logger';
import { getEmbeddingProviderConfig, settings } from '$lib/stores/settings.svelte';
import { type ToolSet } from 'ai';

export interface QueryMemoriesContext {
	memory: Memory;
	storyId: string;
	actLineId: string;
}

interface MemoryResult {
	actNumber: number | null;
	messagesAgo: number;
	location: string;
	memory: string;
}

async function toResults(items: MemoryItem[]): Promise<MemoryResult[]> {
	// Group messageIds by actLineId
	const grouped: Record<string, string[]> = {};
	for (const item of items) {
		if (!grouped[item.actLineId]) grouped[item.actLineId] = [];
		grouped[item.actLineId].push(item.messageId);
	}

	const infoMap = await batchResolveActLineInfo(grouped);

	return items.map((item) => {
		const actLineInfo = infoMap.get(item.actLineId);
		const msgSeq = actLineInfo?.messages.get(item.messageId) ?? null;
		const maxSeq = actLineInfo?.maxSeq ?? 0;
		const messagesAgo = msgSeq !== null ? maxSeq - msgSeq : -1;
		return {
			actNumber: actLineInfo?.actNumber ?? null,
			messagesAgo,
			location: item.location,
			memory: item.memory,
		};
	});
}

function deduplicateMemoryItems(items: MemoryItem[]): MemoryItem[] {
	const seen = new Set<string>();
	return items
		.filter((item) => {
			if (seen.has(item.id)) return false;
			seen.add(item.id);
			return true;
		})
		.sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity));
}

const CHARACTER_QUERY_DESC =
	'A short description of the character or topic to search memories for (e.g. "Elena", "the blacksmith"). If omitted, the tool will return memories based on the time-location query context parameter.';
const TIME_AND_LOCATION_DESC =
	'A short description of the location or time period (e.g., "The Tavern", "Dawn in the Forest"). If omitted, will return memories of the given character.';
const CURRENT_ACT_ONLY_DESC =
	'If true, searches only recent memories from the current act. Set to false to retrieve long-term lore or events from past acts.';
const TOOL_DESCRIPTION = `Search the game's memory database to recall past events, locations visited, or character interactions. You must provide a character query, a time-location query for context, or both. Returns a list of recalled memories with their act number, recency, and location.`;

export function createQueryMemoriesTool(context: QueryMemoriesContext) {
	const { memory, storyId, actLineId } = context;

	const inputSchema = z.object({
		characterQuery: z.string().optional().describe(CHARACTER_QUERY_DESC),
		timeAndLocation: z.string().optional().describe(TIME_AND_LOCATION_DESC),
		currentActOnly: z.boolean().optional().default(true).describe(CURRENT_ACT_ONLY_DESC),
	});

	return tool({
		description: TOOL_DESCRIPTION,
		inputSchema,
		execute: async (input: z.infer<typeof inputSchema>): Promise<MemoryResult[]> => {
			const { characterQuery, timeAndLocation, currentActOnly } = input;
			await fileLog(
				'debug',
				'tool',
				`triggering query memories:
				  characterQuery=${characterQuery}
				  timeAndLocation=${timeAndLocation}
				  currentActOnly=${currentActOnly}`
			);
			const opts = {
				storyId,
				actLineId: currentActOnly ? actLineId : undefined,
				limit: 10,
			};

			let items: MemoryItem[];

			if (characterQuery && timeAndLocation) {
				const resolvedNames = await memory.resolveAliases(storyId, actLineId, characterQuery);
				const allItems = await Promise.all(resolvedNames.map((name) => memory.searchByLocation(name, timeAndLocation, opts)));
				items = deduplicateMemoryItems(allItems.flat());
				return await toResults(items.slice(0, opts.limit));
			} else if (characterQuery) {
				const resolvedNames = await memory.resolveAliases(storyId, actLineId, characterQuery);
				const allItems = await Promise.all(resolvedNames.map((name) => memory.search(name, opts)));
				items = deduplicateMemoryItems(allItems.flat());
				return await toResults(items.slice(0, opts.limit));
			} else if (timeAndLocation) {
				const locations = await memory.searchLocations(timeAndLocation, opts);
				items = await Promise.all(locations.map((location) => memory.sampleByLocation(location, opts.limit))).then((p) => p.flat());
				return await toResults(sampleSize(items, opts.limit));
			} else {
				return [];
			}
		},
	});
}

export function buildMemoryTools(storyId: string | null, actLineId: string): ToolSet {
	if (!settings.memoryEnabled) return {};
	if (!storyId || !actLineId) return {};

	const memConfig = getEmbeddingProviderConfig();
	if (!memConfig) return {};

	return {
		'query-memories': createQueryMemoriesTool({
			memory: new Memory(memConfig),
			storyId,
			actLineId,
		}),
	};
}
