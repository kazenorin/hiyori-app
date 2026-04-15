import {getMainProviderConfig, type ProviderConfig} from '$lib/stores/settings.svelte';
import {loadSystemPrompt} from '$lib/fs/prompts';
import type {GameData} from '$lib/db/messages';
import * as dbMessages from '$lib/db/messages';
import * as dbActLines from '$lib/db/act-lines';
import {logMainChat} from '$lib/logging/chat-logger';
import {type StreamState} from '$lib/ai/chat-callbacks';
import {buildMetadata, type MessageMetadata, streamChatResponse} from "./chat-stream";

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

async function persistMessage(
	actLineId: string,
	message: Message
): Promise<void> {
	await dbMessages.createMessage(
		message.id,
		'assistant',
		message.content,
		message.reasoning,
		message.metadata ? JSON.stringify(message.metadata) : undefined,
		message.gameData
	);
	const seq = await dbActLines.getNextSequence(actLineId);
	await dbActLines.addMessageToLine(actLineId, message.id, seq);
}

/**
 * Handle errors from streaming: persist partial on abort, remove message on other errors.
 */
async function handleStreamError(err: unknown, messageId: string, actLineId: string): Promise<void> {
	if (err instanceof DOMException && err.name === 'AbortError') {
		// User cancelled — persist partial content (fire and forget)
		const partial = messages.find((m) => m.id === messageId);
		if (partial && partial.content) {
			await persistMessage(actLineId, partial);
		}
	} else {
		error = err instanceof Error ? err.message : 'An unexpected error occurred.';
		messages = messages.filter((m) => m.id !== messageId);
	}
}

export async function sendMessage(
	actLineId: string,
	message: {
		bodyText: string | undefined,
		systemPrompt: string | undefined,
		narrationContent: string | undefined
	}
): Promise<void> {
	if (!message.bodyText && !message.systemPrompt && !message.narrationContent) {
		return;
	}

	const providerConfig = getMainProviderConfig();
	if (!providerConfig?.apiKey) {
		error = 'Please configure your API key in Settings.';
		return;
	}
	if (!providerConfig?.model) {
		error = 'Please configure a model name in Settings.';
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
			.map((m) => toHistoryMessage(m));
		const history = [...narrationMsg, ...existingMsgs];

		const [resultMetadata] = await Promise.all([
			streamChatResponse(systemPrompt, history, abortController!.signal,
				(state: StreamState) => {
					messages[messageIdx] = {
						...messages[messageIdx],
						content: state.content,
						reasoning: state.reasoning ?? messages[messageIdx].reasoning,
						gameData: state.gameData ?? messages[messageIdx].gameData
					};
				},
				providerConfig
			).then((acc) => acc.resultMetadata),
			logMainChat({systemPrompt, messages: history})
		])

		// Update message with accumulated content and final metadata
		messages[messageIdx].metadata = buildMetadata(resultMetadata, providerConfig.model);

		// Persist with accumulated content (not result.content)
		await persistMessage(actLineId, messages[messageIdx]);
	} catch (err: unknown) {
		await handleStreamError(err, responseMessageId, actLineId);
	} finally {
		isStreaming = false;
		abortController = null;
	}
}

function toHistoryMessage(message: Message) {
	const gameDataContent = `\n\n\`\`\`json
${JSON.stringify(message.gameData ? message.gameData : placeholderContent(), null, 2)}
\`\`\`\n`
	return {role: message.role, content: message.content + gameDataContent};
}

function randomItem<T>(items: readonly T[]): T {
	return items[Math.floor(Math.random() * items.length)]
}

// Randomized history for placeholder content so that to encourage the LLM to actually offer options
function placeholderContent(): GameData {
	return {
		worldState: randomWorldStateMessage(),
		decisions: [1, 2, 3, 4].map((i) => randomPositionalDecisions(i))
	}
}

function randomWorldStateMessage(): string {
	const intros = [
		"Refer to",
		"Check",
		"Look at",
		"Review",
		"Consult",
		"See",
		"Use",
		"Read"
	] as const

	const subjects = [
		"the chat history",
		"the conversation above",
		"the messages above",
		"the earlier conversation",
		"the discussion above",
		"the story so far",
		"the story above",
		"what was said earlier",
		"the earlier messages",
		"the previous context"
	] as const

	const endings = [
		".",
		" for context.",
		" for details.",
		" for reference.",
		" to understand the situation.",
		" to see what happened before."
	] as const

	return `${randomItem(intros)} ${randomItem(subjects)}${randomItem(endings)}`
}

function randomPositionalDecisions(i: number): string {
	return randomItem([
		`Option ${i}.`,
		`Select option ${i}.`,
		`Pick option ${i}.`,
		`Go with option ${i}.`,
		`Option ${i} sounds right.`,
		`I will choose option ${i}.`,
		`I want to select option ${i}.`,
		`My choice is option ${i}.`,
		`For this decision, choose option ${i}.`,
		`Option ${i} will be selected.`
	] as const)
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
