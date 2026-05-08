import type { MessageBase } from '$lib/db/messages';
import { type ToolSet } from 'ai';
import { executeStream, type StreamResultMetadata } from './streaming';
import { getMainProviderConfig, type ProviderConfig } from '../stores/settings.svelte';
import { createStreamAccumulator, type StreamAccumulator, type StreamState } from './chat-callbacks';
import type { OutputDescriptor } from '$lib/chat-stream-parser/types';
import { createModel } from './provider';
import { isAbortError, isAuthError, sleepOrAbort } from '$lib/utils/async';

export interface RetryConfig {
	retryCount: number;
	backoffIntervalSeconds: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
	retryCount: 2,
	backoffIntervalSeconds: 2,
};

export interface StreamWithRetryOptions {
	retryConfig: RetryConfig;
	onProgress: (state: StreamState) => void;
	onError: (err: Error, attempt: number) => void;
	providerConfig?: ProviderConfig;
	tools?: ToolSet;
	abortSignal?: AbortSignal;
	onRetry?: (attempt: number, maxAttempts: number) => void;
	descriptors?: OutputDescriptor[];
}

export interface MessageMetadata {
	model: string;
	finishReason: string;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	durationMs: number;
}

export function buildMetadata(result: StreamResultMetadata, model?: string): MessageMetadata {
	return {
		model: model ?? 'unknown',
		finishReason: result.finishReason,
		promptTokens: result.usage.inputTokens,
		completionTokens: result.usage.outputTokens,
		totalTokens: result.usage.totalTokens,
		durationMs: result.durationMs,
	};
}

/**
 * Core streaming helper for chat responses.
 * Handles streaming, metadata capture, persistence, and error handling.
 * Callers provide the message history and state setup.
 */
export async function streamChatResponse(
	systemPrompt: string,
	history: MessageBase[],
	abortSignal: AbortSignal,
	onStateUpdate: (state: StreamState) => void,
	onError: (err: unknown) => void,
	providerConfig: ProviderConfig | undefined,
	tools?: ToolSet,
	descriptors?: OutputDescriptor[]
): Promise<StreamAccumulator> {
	if (!providerConfig) {
		throw new Error('No main provider configured. Please set one in Settings.');
	}
	const model = createModel(providerConfig);

	// Create stream accumulator with parser chain integrated
	const accumulator = createStreamAccumulator(onStateUpdate, onError, descriptors);

	await executeStream(
		{
			model,
			messages: history,
			systemPrompt,
			abortSignal: abortSignal,
			providerOptions: {
				openai: {
					reasoningEffort: 'medium',
					reasoningSummary: 'detailed',
				},
			},
			tools,
		},
		accumulator.callbacks
	);

	return accumulator;
}

/**
 * Execute a streaming LLM call with retry logic.
 * Awaits the stream's result metadata to detect mid-stream errors,
 * then retries with linear backoff if the error is retryable.
 * Abort errors and auth errors are not retried.
 */
export async function streamWithRetry(
	systemPrompt: string,
	messages: MessageBase[],
	options: StreamWithRetryOptions
): Promise<StreamAccumulator> {
	const { retryConfig, onProgress, onError, providerConfig = getMainProviderConfig(), tools, abortSignal, onRetry, descriptors } = options;

	const maxAttempts = retryConfig.retryCount + 1;
	let lastError: Error | null = null;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		// Check for external abort before starting attempt
		if (abortSignal?.aborted) {
			throw new DOMException('Aborted', 'AbortError');
		}

		try {
			const accumulator = await streamChatResponse(
				systemPrompt,
				messages,
				abortSignal ?? new AbortController().signal,
				onProgress,
				(_err: unknown) => {
					// Stream errors are reported via callback but don't throw.
					// The resultMetadata promise will reject for mid-stream errors.
					// Error reporting is handled in the catch block below.
				},
				providerConfig,
				tools,
				descriptors
			);

			// KEY: await resultMetadata to detect mid-stream errors.
			// executeStream never throws — errors are communicated via callbacks.
			// The accumulator's resultMetadata promise rejects on error, resolves on success.
			await accumulator.resultMetadata;

			return accumulator;
		} catch (e) {
			lastError = e instanceof Error ? e : new Error(String(e));

			// Don't retry on auth errors
			if (isAuthError(lastError)) {
				throw new Error('Authentication failed. Please check your API key in Settings.');
			}

			// Don't retry on user-initiated abort
			if (isAbortError(lastError)) {
				throw lastError;
			}

			// If this was the last attempt, throw
			if (attempt >= retryConfig.retryCount) {
				throw lastError;
			}

			onError(lastError, attempt + 1);
			onRetry?.(attempt + 1, maxAttempts);

			// Backoff with abort awareness
			const backoffMs = retryConfig.backoffIntervalSeconds * 1000 * (attempt + 1);
			if (abortSignal) {
				await sleepOrAbort(backoffMs, abortSignal);
			} else {
				await new Promise((resolve) => setTimeout(resolve, backoffMs));
			}
		}
	}

	throw lastError ?? new Error('Retry failed');
}
