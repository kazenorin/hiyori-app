import { generateText, stepCountIs, type ToolSet } from 'ai';
import type { MessageBase } from '$lib/db/messages';
import { type RetryConfig, streamWithRetry } from '../chat-stream';
import { createModel } from '../provider';
import type { ProviderConfig } from '$lib/stores/settings.svelte';
import type { PhaseName } from '../narrative-types';
import type { PipelineCallbacks, PipelineState } from './types';
import type { StreamState } from '../chat-callbacks';
import { extractCacheTokens, type StreamResultMetadata } from '../streaming';
import type { OutputDescriptor } from '$lib/utils/chat-stream-parser/types';
import { ERR_NO_PROVIDER_FOR_PHASE } from '$lib/definitions/error-messages';
import { isAbortLikeError } from '$lib/utils/async';

export interface StreamingPhaseParams {
	phaseName: PhaseName;
	systemPrompt: string;
	messages: MessageBase[];
	providerConfig: ProviderConfig | undefined;
	abortSignal: AbortSignal;
	tools: ToolSet | undefined;
	callbacks: PipelineCallbacks;
	retryConfig: RetryConfig;
	descriptors: OutputDescriptor[];
	buildStateUpdate: (streamState: StreamState) => Partial<PipelineState>;
}

export function updateState(prev: PipelineState, patch: Partial<PipelineState>): PipelineState {
	return { ...prev, ...patch };
}

export function aggregateMetadata(
	acc: StreamResultMetadata | null,
	phase: StreamResultMetadata,
	modelId: string | null | undefined
): StreamResultMetadata {
	if (!acc) {
		return { ...phase, models: new Set(modelId ? [modelId] : []) };
	}
	return {
		finishReason: phase.finishReason,
		usage: {
			inputTokens: acc.usage.inputTokens + phase.usage.inputTokens,
			outputTokens: acc.usage.outputTokens + phase.usage.outputTokens,
			totalTokens: acc.usage.totalTokens + phase.usage.totalTokens,
			cacheReadTokens: (acc.usage.cacheReadTokens ?? 0) + (phase.usage.cacheReadTokens ?? 0) || undefined,
			cacheWriteTokens: (acc.usage.cacheWriteTokens ?? 0) + (phase.usage.cacheWriteTokens ?? 0) || undefined,
		},
		durationMs: acc.durationMs + phase.durationMs,
		models: new Set([...acc.models, ...(modelId ? [modelId] : [])]),
	};
}

/**
 * Execute a streaming phase with full lifecycle management (start, stream, complete, error).
 * All shared context (abort signal, tools, callbacks) comes from the params object.
 * Retries the entire phase (including buildStateUpdate) up to retryConfig.retryCount times.
 * Inner stream retries are deducted from the outer budget when streamWithRetry consumes them.
 */
export async function executeStreamingPhase(
	params: StreamingPhaseParams,
	state: PipelineState
): Promise<{ state: PipelineState; streamState: StreamState; metadata: StreamResultMetadata }> {
	const { phaseName, systemPrompt, messages, providerConfig, abortSignal, tools, callbacks, retryConfig, descriptors, buildStateUpdate } =
		params;
	let remainingRetries = retryConfig.retryCount;
	let lastError: Error | undefined;

	while (remainingRetries >= 0) {
		if (abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
		callbacks.onPhaseStart(phaseName);
		let streamResult: Awaited<ReturnType<typeof runStreamingPhase>> | undefined;
		try {
			streamResult = await runStreamingPhase(
				phaseName,
				systemPrompt,
				messages,
				providerConfig,
				abortSignal,
				tools,
				callbacks,
				{ retryCount: remainingRetries, backoffIntervalSeconds: retryConfig.backoffIntervalSeconds },
				descriptors
			);
			state = updateState(state, buildStateUpdate(streamResult.state));
			callbacks.onPhaseComplete(phaseName, state);
			return { state, streamState: streamResult.state, metadata: streamResult.metadata };
		} catch (err: unknown) {
			lastError = err instanceof Error ? err : new Error(String(err));
			// Don't retry on user-initiated abort
			if (isAbortLikeError(lastError)) {
				callbacks.onError(phaseName, lastError);
				throw lastError;
			}
			remainingRetries -= Math.max(streamResult?.retriesConsumed ?? 0, 1);
		}
	}

	if (lastError) {
		callbacks.onError(phaseName, lastError);
		throw lastError;
	} else {
		throw new Error('Unrecognized stream state');
	}
}

async function runStreamingPhase(
	phaseName: PhaseName,
	systemPrompt: string,
	messages: MessageBase[],
	providerConfig: ProviderConfig | undefined,
	abortSignal: AbortSignal,
	tools: ToolSet | undefined,
	callbacks: PipelineCallbacks,
	retryConfig: RetryConfig,
	descriptors: OutputDescriptor[]
): Promise<{ state: StreamState; metadata: StreamResultMetadata; retriesConsumed: number }> {
	if (!providerConfig) {
		throw new Error(ERR_NO_PROVIDER_FOR_PHASE(phaseName));
	}

	let retriesConsumed = 0;
	const accumulator = await streamWithRetry(systemPrompt, messages, {
		retryConfig,
		onProgress: (streamState: StreamState) => {
			callbacks.onPhaseStream(phaseName, streamState);
		},
		onError: () => {
			// Intermediate attempt errors are logged here; the final error
			// is thrown and caught by executeStreamingPhase's catch block.
		},
		providerConfig,
		tools,
		abortSignal,
		descriptors,
		onRetry: callbacks.onPhaseRetry
			? (attempt: number, maxAttempts: number) => {
					callbacks.onPhaseRetry!(phaseName, attempt, maxAttempts);
					retriesConsumed++;
				}
			: undefined,
	});

	const metadata = await accumulator.resultMetadata;
	return { state: accumulator.state, metadata, retriesConsumed };
}

/**
 * Run a single non-streaming phase (e.g., Summarizer) and return the generated text and metadata.
 */
export async function runNonStreamingPhase(
	phaseName: string,
	systemPrompt: string,
	messages: MessageBase[],
	providerConfig: ProviderConfig | undefined,
	abortSignal: AbortSignal,
	tools?: ToolSet,
	maxSteps: number = 10
): Promise<{ text: string; metadata: StreamResultMetadata }> {
	if (!providerConfig) {
		throw new Error(ERR_NO_PROVIDER_FOR_PHASE(phaseName));
	}

	const model = await createModel(providerConfig);
	const startTime = Date.now();
	const result = await generateText({
		model,
		messages,
		system: systemPrompt,
		abortSignal,
		...(tools && Object.keys(tools).length > 0 ? { tools } : {}),
		stopWhen: stepCountIs(maxSteps),
		...(providerConfig.callSettings ?? {}),
	});

	const usage = result.usage;
	const cacheTokens = extractCacheTokens(usage as unknown as Record<string, unknown>);
	return {
		text: result.text,
		metadata: {
			finishReason: result.finishReason ?? 'unknown',
			usage: {
				inputTokens: usage.inputTokens ?? 0,
				outputTokens: usage.outputTokens ?? 0,
				totalTokens: usage.totalTokens ?? 0,
				...cacheTokens,
			},
			durationMs: Date.now() - startTime,
			models: new Set(providerConfig.model ? [providerConfig.model] : []),
		},
	};
}
