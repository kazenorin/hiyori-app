import type {MessageBase} from '$lib/db/messages';
import { streamWithRetry, type RetryConfig } from '$lib/ai/chat-stream';
import type { StreamState } from '$lib/ai/chat-callbacks';
import { getReviewerProviderConfig, getMainProviderConfig, SESSION_NUMBER_REGEX } from '$lib/stores/settings.svelte';
import { loadEditorModeExtractionPrompt } from '$lib/fs/prompts';
import { knownCharacterNameList } from '$lib/memory/memory';
import { log } from '$lib/logging/logger';
import { getActiveNarrationTemplateOrDefault, getActiveSystemPromptOrDefault } from '$lib/stores/stories.svelte';
import { type ToolSet } from 'ai';
import type { StreamResultMetadata } from '$lib/ai/streaming';
import type { GameData } from "$lib/db/messages";
import type { NarrativeSections } from '$lib/ai/parser-chain';

export interface ReviewLoopResult {
	content: string;
	scratchpad: string;
	revisedContent: string;
	resultMetadata: StreamResultMetadata;
}

/**
 * Minimal message interface for review loop callbacks.
 * UI-layer Message type shouldn't be imported here to avoid circular deps.
 */
export interface ReviewableMessage {
	content: string;
	draftContent?: string;
	reasoning?: string;
	reviewScratchpad?: string;
	gameData?: GameData;
	sections?: NarrativeSections;
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
	let baseContent = draftMessage.draftContent ?? draftMessage.content;

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

	const content = accumulator.state.content;

	const revisedNarrative = accumulator.state.revisedNarrative;
	if (!revisedNarrative) {
		await log.debug('review-loop', 'No revised_narrative found in response, passing through');
		return null;
	}

	const scratchpad = accumulator.state.reviewScratchpad ?? '';
	return {
		content,
		scratchpad,
		revisedContent: revisedNarrative,
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
			setCurrentMessage({
				...currentMessage,
				content: state.revisedNarrative ?? currentMessage.content,
				reviewScratchpad: state.reviewScratchpad ?? currentMessage.reviewScratchpad,
				reasoning: state.reasoning ?? currentMessage.reasoning,
				gameData: state.revisedGameData ?? state.gameData ?? currentMessage.gameData,
				sections: state.sections ?? currentMessage.sections,
			});
		},
		options.tools
	);

	if (reviewResult) {
		return reviewResult.resultMetadata;
	} else {
		setCurrentMessage({
			...draftMessage,
			draftContent: undefined,
			reviewScratchpad: undefined,
			content: draftContent,
		});
		return null;
	}
}
