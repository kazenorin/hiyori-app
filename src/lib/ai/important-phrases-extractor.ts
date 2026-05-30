import { generateText } from 'ai';
import { createModel } from './provider';
import { getMinorTaskAgentProviderConfig, type MinorTaskAgentProviderConfig } from '$lib/stores/settings.svelte';
import { importantPhrasesSystemPrompt } from '$lib/definitions/feature-prompts';
import { isAuthError, withRetry } from '$lib/utils/async';
import { log } from '$lib/logging/logger';

const MAX_PHRASES = 5;
const RETRY_COUNT = 2;
const BACKOFF_MS = 2000;

export async function extractImportantPhrases(narrativeBody: string): Promise<string[]> {
	const config = getMinorTaskAgentProviderConfig();
	if (!config) {
		await log.warn('important-phrases', 'Minor Task Agent not configured, skipping extraction');
		return [];
	}

	try {
		const text = await generateWithRetry(narrativeBody, config);
		return parsePhrases(text);
	} catch (err) {
		await log.error('important-phrases', 'Failed to extract important phrases', err);
		return [];
	}
}

async function generateWithRetry(narrativeBody: string, config: MinorTaskAgentProviderConfig): Promise<string> {
	const model = await createModel(config);
	const systemPrompt = importantPhrasesSystemPrompt();

	return withRetry(() => generateText({ model, system: systemPrompt, prompt: narrativeBody }).then((r) => r.text), {
		maxAttempts: RETRY_COUNT + 1,
		backoffMs: BACKOFF_MS,
		shouldRetry: (err) => !isAuthError(err),
		onRetry: (attempt) => log.warn('important-phrases', `Extraction attempt ${attempt} failed, retrying...`),
	});
}

function parsePhrases(text: string): string[] {
	return text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.slice(0, MAX_PHRASES);
}
