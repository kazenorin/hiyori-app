import { type ToolSet } from 'ai';
import { executeStream, type StreamResultMetadata } from './streaming';
import { getMainProviderConfig, type ProviderConfig } from '../stores/settings.svelte';
import { createStreamAccumulator, type StreamAccumulator, type StreamState } from './chat-callbacks';
import { createModel } from './provider';
import { isAuthError, sleep } from '$lib/utils/async';

export interface RetryConfig {
	retryCount: number;
	backoffIntervalSeconds: number;
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
	history: { role: 'user' | 'assistant'; content: string }[],
	abortSignal: AbortSignal,
	onStateUpdate: (state: StreamState) => void,
	onError: (err: unknown) => void,
	providerConfig: ProviderConfig | undefined,
	tools?: ToolSet
): Promise<StreamAccumulator> {
	if (!providerConfig) {
		throw new Error('No main provider configured. Please set one in Settings.');
	}
	const model = createModel(providerConfig);

	// Create stream accumulator with parser chain integrated
	const accumulator = createStreamAccumulator(onStateUpdate, onError);

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
			maxSteps: tools ? 3 : undefined,
		},
		accumulator.callbacks
	);

	return accumulator;
}

/**
 * Execute a streaming LLM call with retry logic.
 * Extracts the duplicated retry pattern from generateActFromCards and formatIntoScenes.
 */
export async function streamWithRetry(
	systemPrompt: string,
	messages: { role: 'user' | 'assistant'; content: string }[],
	retryConfig: RetryConfig,
	onProgress: (state: StreamState) => void,
	onError: (err: Error, attempt: number) => void,
	providerConfig: ProviderConfig | undefined = getMainProviderConfig()
): Promise<StreamAccumulator> {
	const abortController = new AbortController();
	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= retryConfig.retryCount; attempt++) {
		try {
			return await streamChatResponse(
				systemPrompt,
				messages,
				abortController.signal,
				onProgress,
				(err: unknown) => {
					onError(err instanceof Error ? err : new Error(String(err)), attempt + 1);
				},
				providerConfig
			);
		} catch (e) {
			lastError = e instanceof Error ? e : new Error(String(e));
			if (isAuthError(lastError)) {
				throw new Error('Authentication failed. Please check your API key in Settings.');
			}
			onError(lastError, attempt + 1);

			if (attempt < retryConfig.retryCount) {
				await sleep(retryConfig.backoffIntervalSeconds * 1000 * (attempt + 1));
			}
		}
	}

	throw lastError;
}
