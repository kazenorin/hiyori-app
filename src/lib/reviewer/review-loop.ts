import type { MessageBase } from '$lib/db/messages';
import { streamWithRetry, type RetryConfig } from '$lib/ai/chat-stream';
import type { StreamState } from '$lib/ai/chat-callbacks';
import { getReviewerProviderConfig, getMainProviderConfig, SESSION_NUMBER_REGEX } from '$lib/stores/settings.svelte';
import { loadEditorModeExtractionPrompt } from '$lib/fs/prompts';
import { knownCharacterNameList } from '$lib/memory/memory';
import { log } from '$lib/logging/logger';
import { getActiveNarrationTemplateOrDefault, getActiveSystemPromptOrDefault } from '$lib/stores/stories.svelte';
import { type ToolSet } from 'ai';
import type { StreamResultMetadata } from '$lib/ai/streaming';
import type { NarrativeVariables } from '$lib/ai/parser-chain';
import { hasNarrativeBody } from '$lib/ai/template-renderer';

export interface ReviewLoopResult {
	variables: NarrativeVariables;
	resultMetadata: StreamResultMetadata;
}

/**
 * Minimal message interface for review loop callbacks.
 * UI-layer Message type shouldn't be imported here to avoid circular deps.
 */
export interface ReviewableMessage {
	content: string;
	draft?: NarrativeVariables;
	result?: NarrativeVariables;
	reasoning?: string;
	reviewScratchpad?: string;
}

export interface ReviewLoopOptions {
	sessionNumber?: number;
	tools?: ToolSet;
}

const RETRY_CONFIG: RetryConfig = { retryCount: 2, backoffIntervalSeconds: 2 };

function getProviderConfig() {
	return getReviewerProviderConfig() ?? getMainProviderConfig();
}

function getPreprocessedContent(draftMessage: ReviewableMessage, options: ReviewLoopOptions): string {
	let baseContent = draftMessage.content;

	if (options.sessionNumber) {
		const expectedNextSessionNumber = options.sessionNumber + 1;
		baseContent = baseContent.replace(SESSION_NUMBER_REGEX, (match, p1) => {
			return match.replace(p1, expectedNextSessionNumber.toString());
		});
	}

	return baseContent;
}

export async function streamReview(
	history: MessageBase[],
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

	const [resultMetadata] = await Promise.all([
		accumulator.resultMetadata,
		log.info('review-loop', 'Editor mode produced revised narrative'),
	]);

	const vars = accumulator.state.variables;
	if (!vars || !hasNarrativeBody(vars)) {
		await log.debug('review-loop', 'No revised narrative found in response, passing through');
		return null;
	}

	return {
		variables: vars,
		resultMetadata,
	};
}

export async function runReviewLoop(
	getCurrentMessage: () => ReviewableMessage,
	setCurrentMessage: (message: ReviewableMessage) => void,
	history: MessageBase[],
	options: ReviewLoopOptions
): Promise<StreamResultMetadata | null> {
	const draftMessage = getCurrentMessage();
	const draftContent = getPreprocessedContent(draftMessage, options);

	const historyWithDraft: MessageBase[] = [...history, { role: 'assistant', content: draftContent }];

	const reviewResult = await streamReview(
		historyWithDraft,
		(state: StreamState) => {
			const currentMessage = getCurrentMessage();
			const vars = state.variables;
			setCurrentMessage({
				...currentMessage,
				result: vars ?? currentMessage.result ?? currentMessage.draft,
				reviewScratchpad: vars?.scratchpad ?? currentMessage.reviewScratchpad,
				reasoning: state.reasoning ?? currentMessage.reasoning,
			});
		},
		options.tools
	);

	if (reviewResult) {
		const currentMessage = getCurrentMessage();
		setCurrentMessage({
			...currentMessage,
			result: reviewResult.variables ?? currentMessage.result ?? currentMessage.draft,
		});
		return reviewResult.resultMetadata;
	} else {
		setCurrentMessage({
			...draftMessage,
			result: draftMessage.draft,
			reviewScratchpad: undefined,
		});
		return null;
	}
}
