// LLM-based act generation from world + act + character cards
// Uses streaming via chat-stream.ts for real-time feedback

import { streamChatResponse } from '$lib/ai/chat-stream';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { loadSystemPrompt, loadNarrationTemplate } from '$lib/fs/prompts';
import { sleep, isAuthError } from '$lib/utils/async';
import type { RetryConfig } from './types';
import {
	WORLD_CARD_LABEL,
	ACT_CARD_LABEL,
	CHARACTER_CARD_LABEL,
	ACT_GENERATION_INSTRUCTION,
	SCENE_FORMAT_PROMPT
} from './prompts';

// === Shared Retry Logic ===

/**
 * Execute a streaming LLM call with retry logic.
 * Extracts the duplicated retry pattern from generateActFromCards and formatIntoScenes.
 */
async function streamWithRetry(
	systemPrompt: string,
	messages: { role: 'user' | 'assistant'; content: string }[],
	retryConfig: RetryConfig,
	onProgress: (text: string) => void,
	errorPrefix: string
): Promise<string> {
	const abortController = new AbortController();
	let accumulatedContent = '';
	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= retryConfig.retryCount; attempt++) {
		try {
			await streamChatResponse(
				systemPrompt,
				messages,
				abortController.signal,
				(state) => {
					accumulatedContent = state.content;
					onProgress(state.content);
				}
			);

			return accumulatedContent;
		} catch (e) {
			lastError = e instanceof Error ? e : new Error(String(e));
			if (isAuthError(lastError)) {
				throw new Error('Authentication failed. Please check your API key in Settings.');
			}
			onProgress(`${errorPrefix} attempt ${attempt + 1} failed: ${lastError.message}. Retrying...`);

			if (attempt < retryConfig.retryCount) {
				await sleep(retryConfig.backoffIntervalSeconds * 1000 * (attempt + 1));
			}
		}
	}

	throw new Error(`${errorPrefix} failed after ${retryConfig.retryCount + 1} attempts: ${lastError?.message}`);
}

// === Act Generation ===

/**
 * Generate act content using LLM when no transcript is provided.
 * Uses world card, act card, and character cards as context.
 * Streams content for real-time display.
 */
export async function generateActFromCards(
	worldContent: string | null,
	actCardContent: string | null,
	characterCards: { name: string; content: string }[],
	retryConfig: RetryConfig,
	onProgress: (text: string) => void
): Promise<string> {
	const config = getMainProviderConfig();
	if (!config?.apiKey) {
		throw new Error('No main provider configured. Please set one in Settings.');
	}

	const systemPrompt = await loadSystemPrompt();
	const userMessages = buildGenerationMessages(worldContent, actCardContent, characterCards);

	return streamWithRetry(
		systemPrompt,
		userMessages as { role: 'user' | 'assistant'; content: string }[],
		retryConfig,
		onProgress,
		'Act generation'
	);
}

function buildGenerationMessages(
	worldContent: string | null,
	actCardContent: string | null,
	characterCards: { name: string; content: string }[]
): { role: 'user'; content: string }[] {
	const messages: { role: 'user'; content: string }[] = [];

	// World card
	if (worldContent) {
		messages.push(
			{ role: 'user', content: WORLD_CARD_LABEL },
			{ role: 'user', content: worldContent }
		);
	}

	// Act card
	if (actCardContent) {
		messages.push(
			{ role: 'user', content: ACT_CARD_LABEL },
			{ role: 'user', content: actCardContent }
		);
	}

	// Character cards
	for (const card of characterCards) {
		const name = card.name || 'a character in the story';
		messages.push(
			{ role: 'user', content: CHARACTER_CARD_LABEL.replace('{name}', name) },
			{ role: 'user', content: card.content }
		);
	}

	// Generation request
	messages.push({
		role: 'user',
		content: ACT_GENERATION_INSTRUCTION
	});

	return messages;
}

// === Scene Formatting ===

/**
 * Format raw generated content into the narration-template format.
 * Feeds content back to LLM to split into scenes with proper structure.
 */
export async function formatIntoScenes(
	rawContent: string,
	actNumber: number,
	retryConfig: RetryConfig,
	onProgress: (text: string) => void
): Promise<string> {
	const config = getMainProviderConfig();
	if (!config?.apiKey) {
		// If no config, return raw content
		return rawContent;
	}

	const systemPrompt = await loadSystemPrompt();
	const narrationTemplate = await loadNarrationTemplate();

	const formatPrompt = SCENE_FORMAT_PROMPT
		.replace('{actNumber}', String(actNumber))
		.replace('{rawContent}', rawContent)
		.replace('{narrationTemplate}', narrationTemplate);

	const messages: { role: 'user'; content: string }[] = [
		{ role: 'user', content: formatPrompt }
	];

	try {
		return await streamWithRetry(
			systemPrompt,
			messages,
			retryConfig,
			onProgress,
			'Formatting'
		);
	} catch {
		// Fallback: return raw content if formatting fails
		onProgress('Formatting failed, using raw content.');
		return rawContent;
	}
}
