import type { MessageBase } from '$lib/db/messages';
import { streamWithRetry, type RetryConfig } from '$lib/ai/chat-stream';
import type { StreamState } from '$lib/ai/chat-callbacks';
import { getReviewerProviderConfig, getMainProviderConfig } from '$lib/stores/settings.svelte';
import { loadReviewerPrompt, loadEditorPrompt, loadGeneralInstructions, loadWriterOutputTemplate } from '$lib/fs/prompts';
import { log } from '$lib/logging/logger';
import { getActiveSystemPromptOrDefault } from '$lib/stores/stories.svelte';
import { type ToolSet } from 'ai';
import type { StreamResultMetadata } from '$lib/ai/streaming';
import type { NarrativeVariables } from '$lib/ai/narrative-types';
import { hasNarrativeBody } from '$lib/ai/template-renderer';

export interface ReviewLoopResult {
	variables: NarrativeVariables;
	resultMetadata: StreamResultMetadata;
}

/**
 * Minimal message interface for review loop callbacks.
 * UI-layer Message type shouldn't be imported here to avoid circular deps.
 */
export interface ReviewableMessage extends MessageBase {
	reasoning?: string;
	variables?: NarrativeVariables;
}

export interface ReviewLoopOptions {
	tools?: ToolSet;
}

const RETRY_CONFIG: RetryConfig = { retryCount: 2, backoffIntervalSeconds: 2 };

function getProviderConfig() {
	return getReviewerProviderConfig() ?? getMainProviderConfig();
}

export async function streamReview(
	history: MessageBase[],
	onProgress?: (state: StreamState) => void,
	tools?: ToolSet
): Promise<ReviewLoopResult | null> {
	const [systemPrompt, reviewerTemplate, editorTemplate, generalInstructions, writerOutputTemplate] = await Promise.all([
		getActiveSystemPromptOrDefault(),
		loadReviewerPrompt(),
		loadEditorPrompt(),
		loadGeneralInstructions(),
		loadWriterOutputTemplate(),
	]);

	// Combine general instructions, reviewer prompt, editor prompt, and writer output template
	const combinedPrompt = [
		generalInstructions,
		reviewerTemplate,
		editorTemplate,
		'\n## Writer Output Template\n' + writerOutputTemplate,
	].join('\n\n');

	const historyWithEditorPrompt = [...history, { role: 'user' as const, content: combinedPrompt }];

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

	const historyWithDraft: MessageBase[] = [...history, { role: 'assistant', content: draftMessage.content }];

	const reviewResult = await streamReview(
		historyWithDraft,
		(state: StreamState) => {
			const currentMessage = getCurrentMessage();
			const vars = state.variables;
			setCurrentMessage({
				...currentMessage,
				variables: vars ?? currentMessage.variables,
				reasoning: state.reasoning ?? currentMessage.reasoning,
			});
		},
		options.tools
	);

	if (reviewResult) {
		const currentMessage = getCurrentMessage();
		setCurrentMessage({
			...currentMessage,
			variables: reviewResult.variables ?? currentMessage.variables,
		});
		return reviewResult.resultMetadata;
	} else {
		// No review result — keep current variables as-is
		return null;
	}
}