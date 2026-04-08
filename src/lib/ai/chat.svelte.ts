import { streamText } from 'ai';
import { getSettings } from '$lib/stores/settings.svelte';
import { createModel } from '$lib/ai/provider';
import { loadSystemPrompt } from '$lib/fs/system-prompt';
import * as dbMessages from '$lib/db/messages';
import * as dbActLines from '$lib/db/act-lines';

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

export async function loadActLineMessages(actLineId: string): Promise<void> {
	const dbMsgs = await dbActLines.getMessagesForLine(actLineId);
	messages = dbMsgs.map((m) => ({
		id: m.id,
		role: m.role,
		content: m.content,
		reasoning: m.reasoning,
		metadata: m.metadata ? JSON.parse(m.metadata) : undefined
	}));
	error = null;
}

export function clearMessages(): void {
	messages = [];
	error = null;
	isStreaming = false;
}

export async function sendMessage(actLineId: string, text: string, systemPrompt?: string): Promise<void> {
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

	// Persist user message
	await dbMessages.createMessage(userMessage.id, userMessage.role, userMessage.content);
	const userSeq = await dbActLines.getNextSequence(actLineId);
	await dbActLines.addMessageToLine(actLineId, userMessage.id, userSeq);

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
		const prompt = systemPrompt ?? await loadSystemPrompt();

		// Build message history excluding the empty assistant placeholder
		const history = messages
			.filter((m) => m.id !== assistantId)
			.map((m) => ({ role: m.role, content: m.content }));

		const result = streamText({
			model,
			messages: history,
			system: prompt,
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

		const metadata: MessageMetadata = {
			model: settings.model,
			finishReason,
			promptTokens: usage.inputTokens ?? 0,
			completionTokens: usage.outputTokens ?? 0,
			totalTokens: usage.totalTokens ?? 0,
			durationMs
		};

		messages = messages.map((m) =>
			m.id === assistantId
				? { ...m, reasoning, metadata }
				: m
		);

		// Persist assistant message
		await dbMessages.createMessage(
			assistantId,
			'assistant',
			finalMessage?.content ?? '',
			reasoning,
			JSON.stringify(metadata)
		);
		const assistantSeq = await dbActLines.getNextSequence(actLineId);
		await dbActLines.addMessageToLine(actLineId, assistantId, assistantSeq);
	} catch (err: unknown) {
		if (err instanceof DOMException && err.name === 'AbortError') {
			// User cancelled — persist partial content
			const partial = messages.find((m) => m.id === assistantId);
			if (partial && partial.content) {
				await dbMessages.createMessage(
					assistantId,
					'assistant',
					partial.content,
					partial.reasoning || undefined
				);
				const seq = await dbActLines.getNextSequence(actLineId);
				await dbActLines.addMessageToLine(actLineId, assistantId, seq);
			}
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
