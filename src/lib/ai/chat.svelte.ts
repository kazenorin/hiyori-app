import { streamText } from 'ai';
import { getSettings } from '$lib/stores/settings.svelte';
import { createModel } from '$lib/ai/provider';
import { loadSystemPrompt } from '$lib/fs/system-prompt';

export interface MessageMetadata {
	model: string;
	finishReason: string;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	durationMs: number;
}

export interface Message {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	reasoning?: string;
	metadata?: MessageMetadata;
}

let messages = $state<Message[]>([]);
let isStreaming = $state(false);
let error = $state<string | null>(null);
let abortController: AbortController | null = null;

export function getMessages(): Message[] {
	return messages;
}

export function getIsStreaming(): boolean {
	return isStreaming;
}

export function getError(): string | null {
	return error;
}

export async function sendMessage(text: string): Promise<void> {
	const settings = getSettings();

	if (!settings.apiKey) {
		error = 'Please configure your API key in Settings.';
		return;
	}

	if (!settings.model) {
		error = 'Please configure a model name in Settings.';
		return;
	}

	error = null;

	const userMessage: Message = {
		id: crypto.randomUUID(),
		role: 'user',
		content: text
	};

	const assistantId = crypto.randomUUID();
	const assistantMessage: Message = {
		id: assistantId,
		role: 'assistant',
		content: '',
		reasoning: ''
	};

	messages = [...messages, userMessage, assistantMessage];
	isStreaming = true;
	abortController = new AbortController();
	const startTime = Date.now();

	try {
		const model = createModel(settings);
		const systemPrompt = await loadSystemPrompt();

		// Build message history excluding the empty assistant placeholder
		const history = messages
			.filter((m) => m.id !== assistantId)
			.map((m) => ({ role: m.role, content: m.content }));

		const result = streamText({
			model,
			messages: history,
			system: systemPrompt,
			abortSignal: abortController.signal,
			providerOptions: {
				openai: {
					reasoningEffort: 'medium',
					reasoningSummary: 'detailed'
				}
			}
		});

		for await (const part of result.fullStream) {
			switch (part.type) {
				case 'reasoning-delta':
					messages = messages.map((m) =>
						m.id === assistantId
							? { ...m, reasoning: (m.reasoning ?? '') + part.text }
							: m
					);
					break;
				case 'text-delta':
					messages = messages.map((m) =>
						m.id === assistantId ? { ...m, content: m.content + part.text } : m
					);
					break;
			}
		}

		// Capture metadata after stream completes
		const usage = await result.usage;
		const finishReason = await result.finishReason;
		const durationMs = Date.now() - startTime;

		// Clear empty reasoning field if no reasoning was generated
		const finalMessage = messages.find((m) => m.id === assistantId);
		const reasoning = finalMessage?.reasoning || undefined;

		messages = messages.map((m) =>
			m.id === assistantId
				? {
						...m,
						reasoning,
						metadata: {
							model: settings.model,
							finishReason,
							promptTokens: usage.inputTokens ?? 0,
							completionTokens: usage.outputTokens ?? 0,
							totalTokens: usage.totalTokens ?? 0,
							durationMs
						}
					}
				: m
		);
	} catch (err: unknown) {
		if (err instanceof DOMException && err.name === 'AbortError') {
			// User cancelled — keep partial content, just stop streaming
		} else {
			const msg = err instanceof Error ? err.message : 'An unexpected error occurred.';
			error = msg;
			// Remove the empty assistant message on error
			messages = messages.filter((m) => m.id !== assistantId);
		}
	} finally {
		isStreaming = false;
		abortController = null;
	}
}

export function stopStreaming(): void {
	abortController?.abort();
}

export function clearChat(): void {
	messages = [];
	error = null;
	isStreaming = false;
}
