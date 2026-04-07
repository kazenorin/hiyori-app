import { streamText } from 'ai';
import { getSettings } from '$lib/stores/settings.svelte';
import { createModel } from '$lib/ai/provider';

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
		content: ''
	};

	messages = [...messages, userMessage, assistantMessage];
	isStreaming = true;
	abortController = new AbortController();
	const startTime = Date.now();

	try {
		const model = createModel(settings);

		// Build message history excluding the empty assistant placeholder
		const history = messages
			.filter((m) => m.id !== assistantId)
			.map((m) => ({ role: m.role, content: m.content }));

		const result = streamText({
			model,
			messages: history,
			system: 'You are a helpful assistant.',
			abortSignal: abortController.signal
		});

		for await (const chunk of result.textStream) {
			messages = messages.map((m) =>
				m.id === assistantId ? { ...m, content: m.content + chunk } : m
			);
		}

		// Capture metadata after stream completes
		const usage = await result.usage;
		const finishReason = await result.finishReason;
		const durationMs = Date.now() - startTime;

		messages = messages.map((m) =>
			m.id === assistantId
				? {
						...m,
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
