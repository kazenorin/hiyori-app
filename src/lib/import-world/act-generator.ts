import type {MessageBase} from '$lib/db/messages';
// LLM-based act generation from world + act + character cards
// Uses streaming via chat-stream.ts for real-time feedback

import type { StreamAccumulator, StreamState } from '$lib/ai/chat-callbacks';
import { type RetryConfig, streamWithRetry } from '$lib/ai/chat-stream';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { loadSystemPrompt, loadNarrationContent } from '$lib/fs/prompts';
import { sleep } from '$lib/utils/async';
import type { ParsedMessage } from './types';
import {
	WORLD_CARD_LABEL,
	ACT_CARD_LABEL,
	CHARACTER_CARD_LABEL,
	ACT_GENERATION_INSTRUCTION,
	SCENE_EXTRACTION_FIRST_PROMPT,
	SCENE_EXTRACTION_CONTINUATION_PROMPT,
} from './prompts';

// === Act Generation ===

/**
 * Generate act content using LLM when no transcript is provided.
 * Uses world card, act card, and character cards as context.
 * Streams content for real-time display.
 */
export async function generateActFromCards(
	systemPrompt: string,
	worldContent: string | null,
	actCardContent: string | null,
	characterCards: { name: string; content: string }[],
	retryConfig: RetryConfig,
	onProgress: (state: StreamState) => void,
	onError: (err: Error, attempt: number) => void
): Promise<StreamAccumulator> {
	const config = getMainProviderConfig();
	if (!config?.apiKey) {
		throw new Error('No main provider configured. Please set one in Settings.');
	}

	const userMessages = buildGenerationMessages(worldContent, actCardContent, characterCards);

	return streamWithRetry(systemPrompt, userMessages as MessageBase[], retryConfig, onProgress, onError);
}

function buildGenerationMessages(
	worldContent: string | null,
	actCardContent: string | null,
	characterCards: { name: string; content: string }[]
): { role: 'user'; content: string }[] {
	const messages: { role: 'user'; content: string }[] = [];

	// World card
	if (worldContent) {
		messages.push({ role: 'user', content: WORLD_CARD_LABEL }, { role: 'user', content: worldContent });
	}

	// Act card
	if (actCardContent) {
		messages.push({ role: 'user', content: ACT_CARD_LABEL }, { role: 'user', content: actCardContent });
	}

	// Character cards
	for (const card of characterCards) {
		const name = card.name || 'a character in the story';
		messages.push({ role: 'user', content: CHARACTER_CARD_LABEL.replace('{name}', name) }, { role: 'user', content: card.content });
	}

	// Generation request
	messages.push({
		role: 'user',
		content: ACT_GENERATION_INSTRUCTION,
	});

	return messages;
}

// === Scene Breakdown ===

/**
 * Break raw content into scenes by splitting on markdown headers.
 * Headers matching patterns like "## Scene", "### Scene X", "## Scene 1: Title" etc.
 * are treated as scene boundaries.
 * If no scene headers found, returns entire content as one scene.
 */
function breakIntoScenes(rawContent: string): string[] {
	// Split on markdown headers that contain "scene" (case-insensitive)
	// Matches: ## Scene, ### Scene 1, ## Scene: Title, ### Scene X - Title, etc.
	const parts = rawContent.split(/^(?=#{1,6}\s+.*scene\b)/im);

	if (parts.length <= 1) {
		// No scene headers found — treat as single scene
		return [rawContent.trim()].filter((s) => s.length > 0);
	}

	// First part may be preamble before any scene header
	const scenes: string[] = [];
	for (const part of parts) {
		const trimmed = part.trim();
		if (trimmed.length > 0) {
			scenes.push(trimmed);
		}
	}

	return scenes.length > 0 ? scenes : [rawContent.trim()];
}

/**
 * Process a single scene through LLM to apply narration template.
 */
async function processScene(
	sceneContent: string,
	narrationTemplate: string,
	previousScenes: string[],
	retryConfig: RetryConfig,
	onProgress: (state: StreamState) => void,
	onError: (err: Error, attempt: number) => void
): Promise<StreamAccumulator> {
	const systemPrompt = await loadSystemPrompt();

	let extractionPrompt: string;
	if (previousScenes.length === 0) {
		// First scene: no prior context
		extractionPrompt = SCENE_EXTRACTION_FIRST_PROMPT.replace('{narrationTemplate}', narrationTemplate).replace(
			'{sceneContent}',
			sceneContent
		);
	} else {
		// Subsequent scenes: include previous scenes for continuity
		const previousContent = previousScenes.map((s, i) => `Scene ${i + 1}:\n${s}`).join('\n\n---\n\n');
		extractionPrompt = SCENE_EXTRACTION_CONTINUATION_PROMPT.replace('{previousScenes}', previousContent)
			.replace('{narrationTemplate}', narrationTemplate)
			.replace('{sceneContent}', sceneContent);
	}

	const messages: { role: 'user'; content: string }[] = [{ role: 'user', content: extractionPrompt }];

	return await streamWithRetry(systemPrompt, messages, retryConfig, onProgress, onError);
}

// === Scene Formatting (Main Entry Point) ===

export interface ProcessedScenesResult {
	scenes: ParsedMessage[];
	rawSceneCount: number;
}

/**
 * Format raw generated content into processed scenes.
 * 1. Break raw content into scenes using markdown headers
 * 2. Process each scene through LLM with narration template
 * 3. Build history as we go (previous scenes inform subsequent ones)
 * 4. Return array of ParsedMessage (one per scene)
 */
export async function formatIntoScenes(
	rawContent: string,
	actNumber: number,
	retryConfig: RetryConfig,
	log: (msg: string) => void,
	onProgress: (text: string) => void
): Promise<ProcessedScenesResult> {
	const config = getMainProviderConfig();
	if (!config?.apiKey) {
		// If no config, return raw content as single scene
		return {
			scenes: [{ role: 'assistant', content: rawContent }],
			rawSceneCount: 1,
		};
	}

	const narration = await loadNarrationContent();

	// Step 1: Break raw content into scenes (using markdown headers)
	const rawScenes = breakIntoScenes(rawContent);
	onProgress(`Act ${actNumber}: Found ${rawScenes.length} scenes. Processing each...`);

	// Step 2: Process each scene with history
	const processedScenes: string[] = [];
	const sceneMessages: ParsedMessage[] = [];

	for (let i = 0; i < rawScenes.length; i++) {
		onProgress(`Processing scene ${i + 1}/${rawScenes.length}...`);

		try {
			const acc = await processScene(
				rawScenes[i],
				narration,
				processedScenes,
				retryConfig,
				(state: StreamState) => {
					const consoleOutput = (state.content ? state.content : state.reasoning) ?? '';
					onProgress(`Scene ${i + 1}: ${consoleOutput}`);
				},
				(err, attempt) => {
					onProgress(`Scene ${i + 1}: Attempt ${attempt + 1} failed: ${err.message}. Retrying...`);
				}
			);

			const processedSceneContent = acc.state.content;
			processedScenes.push(processedSceneContent);
			sceneMessages.push({
				role: 'assistant',
				content: processedSceneContent,
				reasoning: acc.state.reasoning ?? undefined,
				gameData: acc.state.variables?.gameData ?? undefined,
			});

			log(JSON.stringify(await acc.resultMetadata, null, 2));

			// Small delay between scene processing to avoid rate limits
			if (i < rawScenes.length - 1) {
				await sleep(100);
			}
		} catch (error) {
			// If processing fails for a scene, use the raw scene
			const errorMsg = error instanceof Error ? error.message : String(error);
			onProgress(`Scene ${i + 1} processing failed: ${errorMsg}. Using raw content.`);
			processedScenes.push(rawScenes[i]);
			sceneMessages.push({
				role: 'assistant',
				content: rawScenes[i],
			});
		}
	}

	onProgress(`Completed processing ${sceneMessages.length} scenes.`);

	return {
		scenes: sceneMessages,
		rawSceneCount: rawScenes.length,
	};
}
