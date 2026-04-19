import { streamWithRetry, type RetryConfig } from '$lib/ai/chat-stream';
import type { StreamState } from '$lib/ai/chat-callbacks';
import { getReviewerProviderConfig, getMainProviderConfig } from '$lib/stores/settings.svelte';
import { loadEditorModeExtractionPrompt } from '$lib/fs/prompts';
import { knownCharacterNameList } from '$lib/memory/memory';
import { log } from '$lib/logging/logger';
import { getActiveNarrationTemplateOrDefault, getActiveSystemPromptOrDefault } from '$lib/stores/stories.svelte';
import { type ToolSet } from 'ai';

export interface ReviewLoopResult {
	content: string;
	scratchpad: string;
	revisedContent: string;
}

const RETRY_CONFIG: RetryConfig = { retryCount: 2, backoffIntervalSeconds: 2 };

function getProviderConfig() {
	return getReviewerProviderConfig() ?? getMainProviderConfig();
}

export async function streamReview(
	history: { role: 'user' | 'assistant'; content: string }[],
	onProgress?: (state: StreamState) => void,
	tools?: ToolSet
): Promise<ReviewLoopResult | null> {
	const [systemPrompt, narrationTemplate, editorTemplate, characterNames] = await Promise.all([
		getActiveSystemPromptOrDefault(),
		getActiveNarrationTemplateOrDefault(),
		loadEditorModeExtractionPrompt(),
		knownCharacterNameList(),
	]);

	const editorModePrompt = editorTemplate
		.replace('{knownCharacterNameList}', JSON.stringify(characterNames))
		.replace('{narrationTemplate}', narrationTemplate);

	const historyWithEditorPrompt = [...history, { role: 'user' as const, content: editorModePrompt }];

	const providerConfig = getProviderConfig();

	await log.debug('review-loop', 'Starting editor mode pass');

	const accumulator = await streamWithRetry(
		systemPrompt,
		historyWithEditorPrompt,
		RETRY_CONFIG,
		onProgress ?? (() => {}),
		(err, attempt) => log.warn('review-loop', `Editor mode attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`),
		providerConfig,
		tools
	);

	const content = accumulator.state.content;

	const revisedNarrative = accumulator.state.revisedNarrative;
	if (!revisedNarrative) {
		await log.debug('review-loop', 'No revised_narrative found in response, passing through');
		return null;
	}

	const scratchpad = accumulator.state.reviewScratchpad ?? '';
	await log.info('review-loop', 'Editor mode produced revised narrative');

	return {
		content,
		scratchpad,
		revisedContent: revisedNarrative,
	};
}
