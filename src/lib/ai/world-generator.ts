import { streamText } from 'ai';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { createModel } from '$lib/ai/provider';
import { loadWorldTemplate, loadGenerateWorldFromChatPrompt, loadGenerateWorldFromChatSystemPrompt } from '$lib/fs/world-prompts';
import * as dbActs from '$lib/db/acts';
import * as dbActLines from '$lib/db/act-lines';
import {
	writeTextFile,
	BaseDirectory
} from '@tauri-apps/plugin-fs';

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
async function traceStoryMessages(storyId: string): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
	const acts = await dbActs.getActsForStory(storyId);
	if (acts.length === 0) return [];

	// Find act with highest act_number
	const latestAct = acts.reduce((a, b) => (a.actNumber > b.actNumber ? a : b));

	// Get main act line (or first by creation date as fallback)
	const mainLine = await dbActLines.getMainLineForAct(latestAct.id);
	if (!mainLine) return [];

	const results: { role: 'user' | 'assistant'; content: string }[] = [];
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
export async function generateWorld(storyId: string, folderName: string, abortSignal?: AbortSignal): Promise<string> {
	const config = getMainProviderConfig();

	if (!config?.apiKey || !config?.model) {
		throw new Error('API key and model must be configured in Settings.');
	}

	const systemPrompt = await loadGenerateWorldFromChatSystemPrompt();

	const [generatePrompt, worldTemplate] = await Promise.all([
		loadGenerateWorldFromChatPrompt(),
		loadWorldTemplate()
	]);

	const userInstruction = generatePrompt + '\n\n' + worldTemplate;
	const messages = await traceStoryMessages(storyId);

	if (messages.length === 0) {
		throw new Error('No messages found in story to generate world from.');
	}

	// Append the instruction + template as the final user message
	const allMessages = [
		...messages,
		{ role: 'user' as const, content: userInstruction }
	];

	const model = createModel(config!);

	const result = streamText({
		model,
		messages: allMessages,
		system: systemPrompt,
		abortSignal
	});

	const contentParts: string[] = [];
	for await (const part of result.fullStream) {
		if (part.type === 'text-delta') {
			contentParts.push(part.text);
		}
	}

	const worldContent = contentParts.join('');

	// Write to story folder
	const worldPath = `${folderName}/world.md`;
	await writeTextFile(worldPath, worldContent, { baseDir: BaseDirectory.AppData });

	return worldContent;
}
