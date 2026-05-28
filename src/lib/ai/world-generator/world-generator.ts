import type { MessageBase } from '$lib/db/messages';
import { streamText } from 'ai';
import { maxBy } from 'lodash-es';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { createModel } from '$lib/ai/provider';
import { loadWorldTemplate } from '$lib/fs/prompts';
import * as dbActs from '$lib/db/acts';
import * as dbActLines from '$lib/db/act-lines';
import { writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { worldContentHeader, actDescriptionHeader, characterHeader } from '$lib/definitions/common-headers';
import {
	worldFromChatSystemPrompt,
	worldFromChatPrompt,
	worldFromCardsSystemPrompt,
	worldFromCardsPrompt,
	importWorldUnnamedCharacter,
} from '$lib/definitions/feature-prompts';
import {
	ERR_API_KEY_AND_MODEL_NOT_CONFIGURED,
	ERR_NO_AT_LEAST_ONE_CONTENT,
	ERR_NO_MESSAGES_FOR_WORLD,
} from '$lib/definitions/error-messages';

/**
 * Trace back through the act line chain to collect the full message history.
 *
 * Algorithm:
 * 1. Find the act with the highest act_number in the story
 * 2. Get the first act line by creation date of that act
 * 3. Collect messages sorted by sequence
 * 4. If act has continues_from_act_line_id, prepend those messages
 * 5. Move to the parent act and repeat from step 4
 */
async function traceStoryMessages(storyId: string): Promise<MessageBase[]> {
	const acts = await dbActs.getActsForStory(storyId);
	if (acts.length === 0) return [];

	// Find act with highest act_number
	const latestAct = maxBy(acts, 'actNumber')!;

	// Get main act line (or first by creation date as fallback)
	const mainLine = await dbActLines.getMainLineForAct(latestAct.id);
	if (!mainLine) return [];

	const results: MessageBase[] = [];
	let currentActLineId: string | null = mainLine.id;
	let currentAct: dbActs.Act | null = latestAct;

	while (currentActLineId && currentAct) {
		const msgs = await dbActLines.getMessagesForLine(currentActLineId);
		const mapped = msgs.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
		results.unshift(...mapped); // prepend

		currentActLineId = currentAct.continuesFromActLineId;
		if (currentActLineId) {
			// Find the act that owns this act line
			const actLineMeta = await dbActLines.getActLine(currentActLineId);
			if (!actLineMeta) break;
			currentAct = await dbActs.getAct(actLineMeta.actId);
		}
	}

	return results;
}

/**
 * Generate world.md for a story by analyzing its chat history.
 * Uses generate-world-from-chat-prompt.md + world-template.md as system prompt.
 */
export async function generateWorld(storyId: string, abortSignal?: AbortSignal): Promise<string> {
	const config = getMainProviderConfig();

	if (!config?.apiKey || !config?.model) {
		throw new Error(ERR_API_KEY_AND_MODEL_NOT_CONFIGURED);
	}

	const systemPrompt = worldFromChatSystemPrompt();

	const [generatePrompt, worldTemplate] = await Promise.all([Promise.resolve(worldFromChatPrompt()), loadWorldTemplate()]);

	const userInstruction = generatePrompt + '\n\n' + worldTemplate;
	const messages = await traceStoryMessages(storyId);

	if (messages.length === 0) {
		throw new Error(ERR_NO_MESSAGES_FOR_WORLD);
	}

	// Append the instruction + template as the final user message
	const allMessages = [...messages, { role: 'user' as const, content: userInstruction }];

	const model = createModel(config!);

	const result = streamText({
		model,
		messages: allMessages,
		system: systemPrompt,
		abortSignal,
	});

	const contentParts: string[] = [];
	for await (const part of result.fullStream) {
		if (part.type === 'text-delta') {
			contentParts.push(part.text);
		}
	}

	return contentParts.join('');
}

export interface CardInput {
	name: string;
	content: string;
}

export async function generateWorldFromCards(
	worldContent: string | null,
	actCardContent: string | null,
	characterCards: CardInput[],
	folderName: string,
	abortSignal?: AbortSignal
): Promise<string> {
	const config = getMainProviderConfig();

	if (!config?.apiKey || !config?.model) {
		throw new Error(ERR_API_KEY_AND_MODEL_NOT_CONFIGURED);
	}

	const [systemPrompt, generatePrompt, worldTemplate] = await Promise.all([
		Promise.resolve(worldFromCardsSystemPrompt()),
		Promise.resolve(worldFromCardsPrompt()),
		loadWorldTemplate(),
	]);

	const userInstruction = generatePrompt + '\n\n' + worldTemplate;

	const messages: MessageBase[] = [];

	if (worldContent) {
		messages.push({ role: 'user', content: `## ${worldContentHeader()}\n\n${worldContent}` });
	}
	if (actCardContent) {
		messages.push({ role: 'user', content: `## ${actDescriptionHeader()}\n\n${actCardContent}` });
	}
	for (const card of characterCards) {
		const name = card.name || importWorldUnnamedCharacter();
		messages.push({ role: 'user', content: `## ${characterHeader()}: ${name}\n\n${card.content}` });
	}

	if (messages.length === 0) {
		throw new Error(ERR_NO_AT_LEAST_ONE_CONTENT);
	}

	messages.push({ role: 'user', content: userInstruction });

	const model = createModel(config!);

	const result = streamText({
		model,
		messages,
		system: systemPrompt,
		abortSignal,
	});

	const contentParts: string[] = [];
	for await (const part of result.fullStream) {
		if (part.type === 'text-delta') {
			contentParts.push(part.text);
		}
	}

	const generatedContent = contentParts.join('');

	const worldPath = `${folderName}/world.md`;
	await writeTextFile(worldPath, generatedContent, { baseDir: BaseDirectory.AppData });

	return generatedContent;
}
