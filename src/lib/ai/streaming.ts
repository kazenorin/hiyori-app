import type { MessageBase } from '$lib/db/messages';
import { stepCountIs, streamText, type ToolSet } from 'ai';
import type { LanguageModel } from 'ai';
import type { SharedV3ProviderOptions } from '@ai-sdk/provider';
import { fileLog } from '$lib/logging/logger';
import { ERR_EMPTY_STREAM } from '$lib/definitions/error-messages';

const DEFAULT_MAX_STEPS = 10;

export interface StreamConfig {
	model: LanguageModel;
	modelId?: string;
	messages: MessageBase[];
	systemPrompt: string;
	abortSignal: AbortSignal;
	providerOptions?: SharedV3ProviderOptions;
	tools?: ToolSet;
	maxSteps?: number;
}

export interface StreamCallbacks {
	onTextDelta: (text: string) => void;
	onReasoningDelta?: (text: string) => void;
	onComplete: (result: StreamResultMetadata) => void;
	onError: (err: unknown) => void;
}

export interface StreamResultMetadata {
	finishReason: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
	};
	durationMs: number;
	models: Set<string>;
}

export function extractCacheTokens(usage: Record<string, unknown>): { cacheReadTokens?: number; cacheWriteTokens?: number } {
	const details = usage.inputTokenDetails;
	if (!details || typeof details !== 'object') return {};
	const d = details as Record<string, unknown>;
	return {
		cacheReadTokens: typeof d.cacheReadTokens === 'number' ? d.cacheReadTokens : undefined,
		cacheWriteTokens: typeof d.cacheWriteTokens === 'number' ? d.cacheWriteTokens : undefined,
	};
}

/**
 * Execute a streaming text request with callbacks for real-time updates.
 *
 * Handles the streaming loop, metadata capture, and timing.
 * Does NOT handle error recovery — callers should wrap in try/catch.
 */
export async function executeStream(config: StreamConfig, callbacks: StreamCallbacks): Promise<void> {
	const startTime = Date.now();

	try {
		const baseConfig = {
			model: config.model,
			messages: config.messages,
			system: config.systemPrompt,
			abortSignal: config.abortSignal,
			providerOptions: config.providerOptions,
		};

		const hasTools = config.tools && Object.keys(config.tools).length > 0;

		const result = streamText({
			...baseConfig,
			...(hasTools
				? {
						tools: config.tools,
						stopWhen: stepCountIs(!!config.maxSteps && config.maxSteps > 0 ? config.maxSteps : DEFAULT_MAX_STEPS),
					}
				: {}),
		});

		for await (const part of result.fullStream) {
			switch (part.type) {
				case 'text-delta':
					callbacks.onTextDelta(part.text);
					break;
				case 'reasoning-delta':
					if (callbacks.onReasoningDelta) {
						callbacks.onReasoningDelta(part.text);
					}
					break;
				case 'tool-call':
				case 'tool-result':
					// Tool invocations flow through automatically in multi-step mode.
					// The LLM consumes the result and generates text in subsequent steps.
					break;
				case 'error':
					callbacks.onError(part.error);
					await fileLog('error', 'streaming', formatPartError(part.error));
					return;
			}
		}

		const [usage, finishReason, text] = await Promise.all([result.usage, result.finishReason.then((s) => s ?? 'unknown'), result.text]);

		if (text.trim().length === 0) {
			callbacks.onError(new Error(ERR_EMPTY_STREAM));
			await fileLog('warn', 'streaming', `empty body\nUsage: ${JSON.stringify(usage.raw, null, 2)}\n\nFinish Reason: ${finishReason}`);
		} else {
			const cacheTokens = extractCacheTokens(usage as unknown as Record<string, unknown>);
			callbacks.onComplete({
				finishReason,
				usage: {
					inputTokens: usage.inputTokens ?? 0,
					outputTokens: usage.outputTokens ?? 0,
					totalTokens: usage.totalTokens ?? 0,
					...cacheTokens,
				},
				durationMs: Date.now() - startTime,
				models: new Set(config.modelId ? [config.modelId] : []),
			});

			await fileLog('debug', 'streaming', `${text}\n\nUsage: ${JSON.stringify(usage.raw, null, 2)}\n\nFinish Reason: ${finishReason}`);
		}
	} catch (err: unknown) {
		callbacks.onError(err);
		await fileLog('error', 'streaming', formatPartError(err));
	}
}

function formatPartError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	} else {
		try {
			return String(error);
		} catch {
			return 'unknown error';
		}
	}
}
