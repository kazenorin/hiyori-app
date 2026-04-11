import { getSettings } from '$lib/stores/settings.svelte';
import { createModel } from '$lib/ai/provider';
import { loadSystemPrompt } from '$lib/fs/system-prompt';
import { executeStream, type StreamResult } from '$lib/ai/streaming';
import * as dbMessages from '$lib/db/messages';
import * as dbActLines from '$lib/db/act-lines';
import { logMainChat } from '$lib/logging/chat-logger';
import { createStreamAccumulator } from '$lib/ai/chat-callbacks';
import { setMetadata } from '$lib/ai/message-updater';
import type { GameData } from '$lib/db/messages';

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
	gameData?: GameData;
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
		metadata: parseMetadata(m.metadata),
		gameData: m.gameData
	}));
	error = null;
}

export function clearMessages(): void {
	messages = [];
	error = null;
	isStreaming = false;
}

function parseMetadata(raw: string | undefined | null): MessageMetadata | undefined {
	if (!raw) return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

function validateSettings(): string | null {
	const settings = getSettings();
	if (!settings.apiKey) return 'Please configure your API key in Settings.';
	if (!settings.model) return 'Please configure a model name in Settings.';
	return null;
}

function buildMetadata(result: StreamResult): MessageMetadata {
	const settings = getSettings();
	return {
		model: settings.model,
		finishReason: result.finishReason,
		promptTokens: result.usage.inputTokens,
		completionTokens: result.usage.outputTokens,
		totalTokens: result.usage.totalTokens,
		durationMs: result.durationMs
	};
}

async function persistMessage(
	actLineId: string,
	messageId: string,
	content: string,
	reasoning: string | undefined,
	metadata: MessageMetadata | undefined,
	gameData?: GameData
): Promise<void> {
	await dbMessages.createMessage(
		messageId,
		'assistant',
		content,
		reasoning,
		metadata ? JSON.stringify(metadata) : undefined,
		gameData
	);
	const seq = await dbActLines.getNextSequence(actLineId);
	await dbActLines.addMessageToLine(actLineId, messageId, seq);
}

/**
 * Core streaming helper for chat responses.
 * Handles streaming, metadata capture, persistence, and error handling.
 * Callers provide the message history and state setup.
 */
async function streamChatResponse(
	actLineId: string,
	history: { role: "user" | "assistant"; content: string }[],
	systemPrompt: string,
	messageId: string,
	messageIdx: number
): Promise<void> {
	const settings = getSettings();
	const model = createModel(settings);

	await logMainChat({ systemPrompt, messages: history });

	// Create stream accumulator with parser chain integrated
	const accumulator = createStreamAccumulator((state) => {
		messages[messageIdx] = {
			...messages[messageIdx],
			content: state.content,
			reasoning: state.reasoning || undefined,
			gameData: state.gameData || undefined
		};
	});

	const result = await executeStream(
		{
			model,
			messages: history,
			systemPrompt,
			abortSignal: abortController!.signal,
			providerOptions: {
				openai: {
					reasoningEffort: 'medium',
					reasoningSummary: 'detailed'
				}
			}
		},
		accumulator.callbacks
	);

	// Flush parser chain and apply any remaining output
	accumulator.flush();
	const finalState = accumulator.state;

	// Update message with accumulated content and final metadata
	const metadata = buildMetadata(result);
	const reasoning = finalState.reasoning || undefined;
	messages[messageIdx] = setMetadata(messages[messageIdx], reasoning, metadata);

	// Persist with accumulated content (not result.content)
	await persistMessage(
		actLineId,
		messageId,
		finalState.content,
		reasoning,
		metadata,
		finalState.gameData || undefined
	);
}

/**
 * Handle errors from streaming: persist partial on abort, remove message on other errors.
 */
function handleStreamError(err: unknown, messageId: string, actLineId: string): void {
	if (err instanceof DOMException && err.name === 'AbortError') {
		// User cancelled — persist partial content (fire and forget)
		const partial = messages.find((m) => m.id === messageId);
		if (partial && partial.content) {
			persistMessage(actLineId, messageId, partial.content, partial.reasoning || undefined, undefined, partial.gameData);
		}
	} else {
		error = err instanceof Error ? err.message : 'An unexpected error occurred.';
		messages = messages.filter((m) => m.id !== messageId);
	}
}

export async function sendMessage(actLineId: string, message: {
	bodyText: string | undefined,
	systemPrompt: string | undefined,
	narrationContent: string | undefined
}): Promise<void> {
	if (!message.bodyText && !message.systemPrompt && !message.narrationContent) {
		return
	}

	const validationError = validateSettings();
	if (validationError) {
		error = validationError;
		return;
	}

	error = null;

	const responseMessageId = crypto.randomUUID();
	const responseMessage: Message = {
		id: responseMessageId,
		role: 'assistant',
		content: '',
		reasoning: ''
	};

	if (!!message.bodyText && message.bodyText.trim().length > 0) {
		const userMessage: Message = {
			id: crypto.randomUUID(),
			role: 'user',
			content: message.bodyText
		};

		// Persist user message
		await dbMessages.createMessage(userMessage.id, userMessage.role, userMessage.content);
		const userSeq = await dbActLines.getNextSequence(actLineId);
		await dbActLines.addMessageToLine(actLineId, userMessage.id, userSeq);

		messages = [...messages, userMessage, responseMessage];
	} else {
		messages = [...messages, responseMessage];
	}

	const messageIdx = messages.length - 1;

	isStreaming = true;
	abortController = new AbortController();

	try {
		const systemPrompt = message.systemPrompt ?? await loadSystemPrompt();

		const narrationMsg = message.narrationContent ? [{ role: 'user' as const, content: message.narrationContent }] : [];
		const existingMsgs = messages.slice(0, -1)
			.map((m) => ({ role: m.role, content: m.content }));
		const history = [...narrationMsg, ...existingMsgs];

		await streamChatResponse(actLineId, history, systemPrompt, responseMessageId, messageIdx);
	} catch (err: unknown) {
		handleStreamError(err, responseMessageId, actLineId);
	} finally {
		isStreaming = false;
		abortController = null;
	}
}

export function stopStreaming(): void {
	abortController?.abort();
}

export function getLatestDecisions(): string[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'assistant' && messages[i].gameData?.decisions?.length) {
			return messages[i].gameData!.decisions;
		}
	}
	return [];
}

/**
 * Send the narration template as a hidden message.
 * The narration message is never persisted or shown in the UI.
 * Only the assistant's response (the opening narrative) is persisted and displayed.
 */
export async function sendInitialNarration(
	actLineId: string,
	narrationContent: string,
	systemPrompt?: string
): Promise<void> {
	messages = []
	return await sendMessage(actLineId, {bodyText: undefined, systemPrompt: systemPrompt, narrationContent: narrationContent});
}

export async function regenerateLastResponse(actLineId: string, systemPrompt?: string, narrationContent?: string): Promise<void> {
	const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
	if (!lastAssistant) return;

	await dbActLines.removeLastMessageEntries(actLineId, 1);
	messages = messages.filter((m) => m.id !== lastAssistant.id);

	await sendMessage(actLineId, {bodyText: undefined, systemPrompt: systemPrompt, narrationContent: narrationContent});
}

export async function deleteLastExchange(actLineId: string): Promise<void> {
	await dbActLines.removeLastMessageEntries(actLineId, 2);

	const lastMessageIdx = messages.map((m) => m.role).lastIndexOf('assistant');
	if (lastMessageIdx === -1) return;

	const lastUserIdx = messages.slice(0, lastMessageIdx).map((m) => m.role).lastIndexOf('user');
	if (lastUserIdx === -1) {
		messages = messages.filter((m) => m.id !== messages[lastMessageIdx].id);
		return;
	}

	messages = messages.filter((_, i) => i !== lastUserIdx && i !== lastMessageIdx);
}

export async function getForkSequence(actLineId: string, assistantMessageIndex: number): Promise<{ branchSeq: number; name: string }> {
	const assistantMsg = messages[assistantMessageIndex];
	if (!assistantMsg || assistantMsg.role !== 'assistant') {
		throw new Error('Invalid message: expected assistant message');
	}

	const assistantSeq = await dbActLines.getMessageSequence(actLineId, assistantMsg.id);
	if (assistantSeq === null) throw new Error('Could not find message sequence');

	const preceding = messages.slice(0, assistantMessageIndex);
	const userMsgIdx = preceding.map((m) => m.role).lastIndexOf('user');
	const userMsg = userMsgIdx >= 0 ? messages[userMsgIdx] : null;

	return {
		branchSeq: assistantSeq,
		name: userMsg
			? `Fork from "${userMsg.content.slice(0, 30)}${userMsg.content.length > 30 ? '...' : ''}"`
			: 'New Branch'
	};
}
