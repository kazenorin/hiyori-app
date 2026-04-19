import { streamText } from 'ai';
import type { LanguageModel } from 'ai';
import type { SharedV3ProviderOptions } from '@ai-sdk/provider';
import { log, fileLog } from '$lib/logging/logger';

export interface StreamConfig {
	model: LanguageModel;
	messages: { role: 'user' | 'assistant'; content: string }[];
	systemPrompt: string;
	abortSignal: AbortSignal;
	providerOptions?: SharedV3ProviderOptions;
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
	};
	durationMs: number;
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
		const result = streamText({
			model: config.model,
			messages: config.messages,
			system: config.systemPrompt,
			abortSignal: config.abortSignal,
			providerOptions: config.providerOptions,
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
				case 'error':
					callbacks.onError(part.error);
					await fileLog('error', 'streaming', formatPartError(part.error));
					return;
			}
		}

		const [usage, finishReason, text] = await Promise.all([
			result.usage,
			result.finishReason.then((s) => s ?? 'unknown'),
			result.text,
		]);

		if (text.trim().length === 0) {
			callbacks.onError(new Error('empty response from stream'));
			await fileLog(
				'warn',
				'streaming',
				`empty body\nUsage: ${JSON.stringify(usage.raw, null, 2)}\n\nFinish Reason: ${finishReason}`
			);
		} else {
			callbacks.onComplete({
				finishReason,
				usage: {
					...usage,
					inputTokens: usage.inputTokens ?? 0,
					outputTokens: usage.outputTokens ?? 0,
					totalTokens: usage.totalTokens ?? 0,
				},
				durationMs: Date.now() - startTime,
			});

			await fileLog(
				'debug',
				'streaming',
				`${text}\n\nUsage: ${JSON.stringify(usage.raw, null, 2)}\n\nFinish Reason: ${finishReason}`
			);
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
