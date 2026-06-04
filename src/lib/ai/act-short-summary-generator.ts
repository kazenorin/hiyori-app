import { generateText } from 'ai';
import { createModel } from './provider';
import { getSummarizerProviderConfig, getMainProviderConfig } from '$lib/stores/settings.svelte';
import { actShortSummaryExtractionPrompt, actShortSummaryCharacterPrefix, sceneCountLabel } from '$lib/definitions/pipeline-prompts';
import { getLastSceneNumber, recordActShortSummary } from '$lib/db/act-lines';
import type { AssistantContext } from './pipeline/types';
import { isAuthError, withRetry } from '$lib/utils/async';
import { log } from '$lib/logging/logger';
import { parseActSummary } from './act-summary-parser';

const RETRY_COUNT = 2;
const BACKOFF_MS = 2000;

function pluralizeScenes(n: number): string {
	return sceneCountLabel(n);
}

function extractCharacterNames(actSummaryText: string): string[] {
	try {
		const parsed = parseActSummary(actSummaryText);
		return parsed.characters.map((c) => c.characterName);
	} catch {
		return [];
	}
}

export async function generateAndRecordActShortSummary(actLineId: string, actSummary: string, assistant: AssistantContext): Promise<void> {
	const config = getSummarizerProviderConfig() ?? getMainProviderConfig();
	if (!config?.model) {
		await log.warn('act-short-summary', 'No provider configured, skipping');
		return;
	}

	try {
		if (!actSummary) {
			await log.warn('act-short-summary', 'No act summary provided, skipping');
			return;
		}

		const model = await createModel(config);
		const systemPrompt = actShortSummaryExtractionPrompt();

		const characterNames = extractCharacterNames(actSummary);
		let promptText = actSummary;
		if (characterNames.length > 0) {
			promptText += `\n\n${actShortSummaryCharacterPrefix()}: ${characterNames.join(', ')}`;
		}

		const text = await withRetry(() => generateText({ model, system: systemPrompt, prompt: promptText }).then((r) => r.text), {
			maxAttempts: RETRY_COUNT + 1,
			backoffMs: BACKOFF_MS,
			shouldRetry: (err) => !isAuthError(err),
			onRetry: (attempt) => log.warn('act-short-summary', `Attempt ${attempt} failed, retrying...`),
		});

		const sceneCount = (await getLastSceneNumber(actLineId)) ?? 0;
		const summaryWithCount = `${text.trim()} [${pluralizeScenes(sceneCount)}]`;

		await recordActShortSummary(actLineId, assistant, summaryWithCount);
	} catch (err) {
		await log.error('act-short-summary', 'Failed to generate act short summary', err);
	}
}
