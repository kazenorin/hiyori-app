import { tool } from 'ai';
import { z } from 'zod';
import { Memory, type MemoryItem } from '$lib/memory/memory';
import { batchResolveActLineInfo } from '$lib/db/act-lines';

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
	const infoMap = await batchResolveActLineInfo(items.map((item) => ({ actLineId: item.actLineId, messageId: item.messageId })));

	return items.map((item) => {
		const key = `${item.actLineId}:${item.messageId}`;
		const info = infoMap.get(key);
		const messagesAgo = info?.msgSeq !== null && info ? info.maxSeq - 1 - (info.msgSeq ?? 0) : -1;
		return {
			actNumber: info?.actNumber ?? null,
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
				items = await memory.searchByLocation(timeAndLocation, timeAndLocation, opts);
			} else {
				return [];
			}

			return toResults(items.slice(0, 10));
		},
	});
}
