// LLM-based act generation from world + act + character cards

import { generateText } from 'ai';
import { createModel } from '$lib/ai/provider';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { loadSystemPrompt } from '$lib/fs/prompts';
import type { RetryConfig } from './types';

/**
 * Generate act content using LLM when no transcript is provided.
 * Uses world card, act card, and character cards as context.
 */
export async function generateActFromCards(
	worldContent: string | null,
	actCardContent: string | null,
	characterCards: { name: string; content: string }[],
	retryConfig: RetryConfig,
	onProgress?: (text: string) => void
): Promise<string> {
	const config = getMainProviderConfig();
	if (!config?.apiKey) {
		throw new Error('No main provider configured. Please set one in Settings.');
	}

	const model = createModel(config);
	const systemPrompt = await loadSystemPrompt();
	const userMessages = buildGenerationMessages(worldContent, actCardContent, characterCards);

	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= retryConfig.retryCount; attempt++) {
		try {
			const result = await generateText({
				model,
				system: systemPrompt,
				messages: userMessages
			});

			return result.text;
		} catch (e) {
			lastError = e instanceof Error ? e : new Error(String(e));
			if (onProgress) {
				onProgress(`Attempt ${attempt + 1} failed: ${lastError.message}. Retrying...`);
			}

			if (attempt < retryConfig.retryCount) {
				await sleep(retryConfig.backoffIntervalSeconds * 1000 * (attempt + 1));
			}
		}
	}

	throw new Error(`Act generation failed after ${retryConfig.retryCount + 1} attempts: ${lastError?.message}`);
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
			{ role: 'user', content: 'The following message is a world building settings card.' },
			{ role: 'user', content: worldContent }
		);
	}

	// Act card
	if (actCardContent) {
		messages.push(
			{ role: 'user', content: 'The following message is an act card describing the events of the act.' },
			{ role: 'user', content: actCardContent }
		);
	}

	// Character cards
	for (const card of characterCards) {
		const name = card.name || 'Unknown Character';
		messages.push(
			{ role: 'user', content: `The following message is a character card for ${name}.` },
			{ role: 'user', content: card.content }
		);
	}

	// Generation request
	messages.push({
		role: 'user',
		content: 'Generate a story based the above settings.'
	});

	return messages;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
