import { tool } from 'ai';
import { z } from 'zod';
import { Memory, type MemoryItem } from '$lib/memory/memory';
import { batchResolveActLineInfo } from '$lib/db/act-lines';
import {fileLog} from '$lib/logging/logger';
import {getEmbeddingProviderConfig, settings} from '$lib/stores/settings.svelte';
import {type ToolSet} from 'ai';

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

export function createQueryMemoriesTool(context: QueryMemoriesContext) {
	const { memory, storyId, actLineId } = context;

	const inputSchema = z.object({
		characterQuery: z
			.string()
			.optional()
			.describe('A short description of the character or topic to search memories for (e.g. "Elena", "the blacksmith")'),
		timeAndLocation: z
			.string()
			.optional()
			.describe('A short description of time and location context (e.g. "Night at the Tavern", "Dawn in the Forest")'),
		currentActOnly: z
			.boolean()
			.optional()
			.default(true)
			.describe('If true, only search memories from the current act. If false, search all acts.'),
	});

	return tool({
		description:
			"Search the character's memories. Use this to recall past events, locations visited, or interactions. " +
			'Provide a character query and/or a time-and-location description to find relevant memories. ' +
			'Returns a list of recalled memories with their act number, recency, and location.',
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
				items = await memory.searchByLocation(characterQuery, timeAndLocation, opts);
			} else if (characterQuery) {
				items = await memory.search(characterQuery, opts);
			} else if (timeAndLocation) {
				items = await memory.search(timeAndLocation, opts); // TODO: this is wrong
			} else {
				return [];
			}

			return await toResults(items.slice(0, 10));
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
