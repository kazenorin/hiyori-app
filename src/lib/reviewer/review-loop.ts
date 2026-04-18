import { streamWithRetry, type RetryConfig } from '$lib/ai/chat-stream';
import type { StreamState } from '$lib/ai/chat-callbacks';
import { getReviewerProviderConfig, getMainProviderConfig } from '$lib/stores/settings.svelte';
import {
	loadSystemPrompt,
	loadEditorModeExtractionPrompt,
} from '$lib/fs/prompts';
import { knownCharacterNameList } from '$lib/memory/memory';
import { log } from '$lib/logging/logger';

export interface ReviewLoopResult {
	scratchpad: string;
	revisedContent: string;
}

const RETRY_CONFIG: RetryConfig = { retryCount: 2, backoffIntervalSeconds: 2 };

function extractTagContent(text: string, tag: string): string | null {
	const openTag = `<${tag}>`;
	const closeTag = `</${tag}>`;
	const start = text.indexOf(openTag);
	if (start === -1) return null;
	const end = text.indexOf(closeTag, start);
	if (end === -1) return null;
	return text.slice(start + openTag.length, end).trim();
}

function getProviderConfig() {
	return getReviewerProviderConfig() ?? getMainProviderConfig();
}

export async function streamReview(
	history: { role: 'user' | 'assistant'; content: string }[],
	onProgress?: (state: StreamState) => void,
): Promise<ReviewLoopResult | null> {
	const [systemPrompt, editorTemplate, characterNames] = await Promise.all([
		loadSystemPrompt(),
		loadEditorModeExtractionPrompt(),
		knownCharacterNameList(),
	]);

	const editorModePrompt = editorTemplate.replace(
		'{knownCharacterNameList}',
		JSON.stringify(characterNames)
	);

	const historyWithEditorPrompt = [
		...history,
		{ role: 'user' as const, content: editorModePrompt },
	];

	const providerConfig = getProviderConfig();

	await log.debug('review-loop', 'Starting editor mode pass');

	const accumulator = await streamWithRetry(
		systemPrompt,
		historyWithEditorPrompt,
		RETRY_CONFIG,
		onProgress ?? (() => {}),
		(err, attempt) => log.warn('review-loop', `Editor mode attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`),
		providerConfig,
	);

	const content = accumulator.state.content;
	const revisedNarrative = extractTagContent(content, 'revised_narrative');

	if (!revisedNarrative) {
		await log.debug('review-loop', 'No revised_narrative found in response, passing through');
		return null;
	}

	const scratchpad = extractTagContent(content, 'review_scratchpad') ?? '';
	await log.info('review-loop', 'Editor mode produced revised narrative');

	return {
		scratchpad,
		revisedContent: revisedNarrative,
	};
}
