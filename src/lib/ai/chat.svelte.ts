import {getMainProviderConfig, getMemoryProviderConfig, type ProviderConfig, SCENE_NUMBER_REGEX, SESSION_NUMBER_REGEX, settings} from '$lib/stores/settings.svelte';
import {getActiveStoryId, getActiveSystemPromptOrDefault} from '$lib/stores/stories.svelte';
import type {GameData} from '$lib/db/messages';
import * as dbMessages from '$lib/db/messages';
import type {ModelMessage} from 'ai';
import * as dbActLines from '$lib/db/act-lines';
import {logMainChat} from '$lib/logging/chat-logger';
import {type StreamState} from '$lib/ai/chat-callbacks';
import {buildMetadata, type MessageMetadata, streamChatResponse} from './chat-stream';
import {runMemoryExtractionPipeline} from './memory-extraction-pipeline';
import {Memory} from '$lib/memory/memory';
import {runReviewLoop} from '$lib/reviewer/review-loop';
import {log} from '$lib/logging/logger';
import {buildTools} from '$lib/ai/tools/tools';
import type {StreamResultMetadata} from "$lib/ai/streaming";


export interface Message {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	reasoning?: string;
	metadata?: MessageMetadata;
	gameData?: GameData;
	sceneNumber?: number;
	sessionNumber?: number;
	draftContent?: string;
	reviewScratchpad?: string;
}

let messages = $state<Message[]>([]);
let isStreaming = $state(false);
let error = $state<string | null>(null);
let abortController: AbortController | null = null;
let memoryPipelineRunning = $state(false);
let memoryPipelinePromise: Promise<void> | null = null;

export function getMessages(): Message[] {
	return messages;
}

export function isMemoryPipelineRunning(): boolean {
	return memoryPipelineRunning;
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
		gameData: m.gameData,
		sceneNumber: m.sceneNumber,
		sessionNumber: m.sessionNumber,
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

function findLastNonNullSceneNumber(): number | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].sceneNumber != null) return messages[i].sceneNumber;
	}
	return undefined;
}

function findLastNonNullSessionNumber(): number | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].sessionNumber != null) return messages[i].sessionNumber;
	}
	return undefined;
}

function getHistory(message: {
	bodyText: string | undefined;
	systemPrompt: string | undefined;
	narrationContent: ModelMessage[] | undefined;
	sessionNumber?: number
}): { role: 'user' | 'assistant'; content: string }[] {
	const narrations = message.narrationContent?.length
		? message.narrationContent.map(narrowNarrationMessage).filter((m) => m !== null)
		: [];
	// exclude the first message (current message) to get the existing messages
	const existing = messages.slice(0, -1).map((m) => toHistoryMessage(m));
	return [...narrations, ...existing];
}

function narrowNarrationMessage(msg: ModelMessage): { role: 'user' | 'assistant'; content: string } | null {
	if (msg.role !== 'user' && msg.role !== 'assistant') return null;
	if (typeof msg.content === 'string') {
		return { role: msg.role, content: msg.content };
	}
	// Handle array content - extract text parts
	if (Array.isArray(msg.content)) {
		const textParts = msg.content.filter((part) => part.type === 'text');
		const text = textParts.map((part) => (part as { type: 'text'; text: string }).text).join('\n');
		return { role: msg.role, content: text };
	}
	return null;
}

async function persistMessage(actLineId: string, message: Message): Promise<void> {
	await dbMessages.createMessage({
		id: message.id,
		role: 'assistant',
		content: message.content,
		reasoning: message.reasoning,
		metadata: message.metadata ? JSON.stringify(message.metadata) : undefined,
		gameData: message.gameData,
		sceneNumber: message.sceneNumber,
		sessionNumber: message.sessionNumber,
	});
	const seq = await dbActLines.getNextSequence(actLineId);
	await dbActLines.addMessageToLine(actLineId, message.id, seq);
}

async function persistUserMessage(message: {
	bodyText: string;
	systemPrompt: string | undefined;
	narrationContent: ModelMessage[] | undefined;
	sessionNumber?: number
}, actLineId: string) {
	const userSessionNumber = message.sessionNumber ?? findLastNonNullSessionNumber();
	const userSceneNumber = findLastNonNullSceneNumber();

	const userMessage: Message = {
		id: crypto.randomUUID(),
		role: 'user',
		content: message.bodyText,
		sessionNumber: userSessionNumber,
		sceneNumber: userSceneNumber,
	};

	// Persist user message
	await dbMessages.createMessage({
		id: userMessage.id,
		role: userMessage.role,
		content: userMessage.content,
		sceneNumber: userSceneNumber,
		sessionNumber: userSessionNumber,
	});

	const userSeq = await dbActLines.getNextSequence(actLineId);
	await dbActLines.addMessageToLine(actLineId, userMessage.id, userSeq);
	return userMessage;
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

function runMemoryPipeline(storyId: string | null, actLineId: string, message: Message): void {
	if (!settings.memoryEnabled) return;
	if (!storyId || !actLineId) return;
	memoryPipelineRunning = true;
	memoryPipelinePromise = runMemoryExtractionPipeline(message.content, storyId, actLineId, message.id)
		.then((result) => log.debug('memory-pipeline', `Processed ${result.charactersProcessed} characters, ${result.memoriesAdded} memories`))
		.catch((err) => log.error('memory-pipeline', 'Pipeline failed', err))
		.finally(() => {
			memoryPipelinePromise = null;
			memoryPipelineRunning = false;
		});
}

function newMessage(role: 'user' | 'assistant'): Message {
	return {
		id: crypto.randomUUID(),
		role: role,
		content: '',
		reasoning: '',
	};
}

function updateMetaData(getCurrentMessage: () => Message, resultMetadata: StreamResultMetadata | null, providerConfig: ProviderConfig) {
	if (resultMetadata) {
		getCurrentMessage().metadata = buildMetadata(resultMetadata, providerConfig.model);
	}
}

export async function sendMessage(
	actLineId: string,
	message: {
		bodyText: string | undefined;
		systemPrompt: string | undefined;
		narrationContent: ModelMessage[] | undefined;
		sessionNumber?: number;
	}
): Promise<void> {
	const storyIdPromise = dbActLines.getStoryIdForActLine(actLineId);
	if (!message.bodyText && !message.systemPrompt && !message.narrationContent) {
		await log.warn('send-message', 'Called with no body, system prompt, or narration content');
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

	const responseMessage = newMessage('assistant');
	if (!!message.bodyText && message.bodyText.trim().length > 0) {
		const userMessage = await persistUserMessage({...message, bodyText: message.bodyText}, actLineId);
		messages = [...messages, userMessage, responseMessage];
	} else {
		messages = [...messages, responseMessage];
	}

	const messageIdx = messages.length - 1;

	function getCurrentMessage(): Message {
		return messages[messageIdx];
	}

	function setCurrentMessage(message: Message) {
		messages[messageIdx] = message;
	}

	isStreaming = true;
	abortController = new AbortController();
	const storyId = await storyIdPromise;
	const tools = await buildTools(storyId, actLineId);

	try {
		const systemPrompt = message.systemPrompt ?? (await getActiveSystemPromptOrDefault());
		const history = getHistory(message);

		// Await any in-flight memory pipeline before starting a new response
		if (memoryPipelinePromise) {
			await memoryPipelinePromise;
		}

		const resultMetadata = await streamChatResponse(
			systemPrompt,
			history,
			abortController!.signal,
			(state: StreamState) => {
				const currentMessage = getCurrentMessage();
				setCurrentMessage({
					...currentMessage,
					[settings.reviewerEnabled ? 'draftContent' : 'content']: state.content,
					reasoning: state.reasoning ?? currentMessage.reasoning,
					gameData: state.revisedGameData ?? state.gameData ?? currentMessage.gameData,
				});
			},
			(err: unknown) => {
				error = err instanceof Error ? err.message : String(err);
			},
			providerConfig,
			tools
		).then((acc) => acc.resultMetadata)

		// Update message with accumulated content and final metadata
		updateMetaData(getCurrentMessage, resultMetadata, providerConfig);

		// Review loop: run editor mode, revise if needed
		if (settings.reviewerEnabled) {
			const sessionNumber = message.sessionNumber ?? findLastNonNullSessionNumber()
			const reviewedMetadata = await runReviewLoop(getCurrentMessage, (msg) => setCurrentMessage(msg as Message), history, {sessionNumber, tools});
			updateMetaData(getCurrentMessage, reviewedMetadata, providerConfig);
		}

		// Determine sceneNumber and sessionNumber for the assistant response
		determineSceneNumberAndNextSessionNumber(messageIdx, message.sessionNumber);

		// Persist with accumulated content (not result.content)
		await Promise.all([persistMessage(actLineId, getCurrentMessage()), logMainChat({systemPrompt, messages})]);

		// Run memory extraction pipeline in background (non-blocking)
		runMemoryPipeline(storyId, actLineId, getCurrentMessage());
	} catch (err: unknown) {
		await handleStreamError(err, responseMessage.id, actLineId);
	} finally {
		isStreaming = false;
		abortController = null;
	}
}



function determineSceneNumberAndNextSessionNumber(messageIdx: number, explicitSessionNumber?: number): void {
	const content = messages[messageIdx].content;

	const lastSessionNumber = findLastNonNullSessionNumber();
	const sessionNumber =
		lastSessionNumber != null
			? lastSessionNumber + 1
			: (explicitSessionNumber ?? parseSessionNumber(content) ?? 1);

	const sceneNumber = parseSceneNumber(content);

	messages[messageIdx] = {
		...messages[messageIdx],
		sceneNumber,
		sessionNumber,
	};
}

function parseSessionNumber(content: string): number | undefined {
	const match = SESSION_NUMBER_REGEX.exec(content);
	return match ? parseInt(match[1], 10) : undefined;
}

function parseSceneNumber(content: string): number | undefined {
	const match = SCENE_NUMBER_REGEX.exec(content);
	return match ? parseInt(match[1], 10) : undefined;
}

function toHistoryMessage(message: Message): { role: 'user' | 'assistant'; content: string } {
	if (message.role !== 'assistant') {
		return { role: message.role, content: message.content };
	}
	const gameDataContent = `\n\`\`\`json
${JSON.stringify(message.gameData ? message.gameData : placeholderContent(), null, 2)}
\`\`\`\n`;
	return { role: 'assistant', content: message.content + gameDataContent };
}

function randomItem<T>(items: readonly T[]): T {
	return items[Math.floor(Math.random() * items.length)];
}

// Randomized history for placeholder content so that to encourage the LLM to actually offer options
function placeholderContent(): GameData {
	return {
		worldState: randomWorldStateMessage(),
		decisions: [1, 2, 3, 4].map((i) => randomPositionalDecisions(i)),
	};
}

function randomWorldStateMessage(): string {
	const intros = ['Refer to', 'Check', 'Look at', 'Review', 'Consult', 'See', 'Use', 'Read'] as const;

	const subjects = [
		'the chat history',
		'the conversation above',
		'the messages above',
		'the earlier conversation',
		'the discussion above',
		'the story so far',
		'the story above',
		'what was said earlier',
		'the earlier messages',
		'the previous context',
	] as const;

	const endings = [
		'.',
		' for context.',
		' for details.',
		' for reference.',
		' to understand the situation.',
		' to see what happened before.',
	] as const;

	return `${randomItem(intros)} ${randomItem(subjects)}${randomItem(endings)}`;
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
		`Option ${i} will be selected.`,
	] as const);
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
export async function sendInitialNarration(actLineId: string, narrationContent: ModelMessage[], systemPrompt?: string): Promise<void> {
	messages = [];
	return await sendMessage(actLineId, {
		bodyText: undefined,
		systemPrompt: systemPrompt,
		narrationContent: narrationContent,
		sessionNumber: 0,
	});
}

export async function regenerateLastResponse(
	actLineId: string,
	messageId: string,
	narrationContent: ModelMessage[],
	systemPrompt?: string
): Promise<void> {
	const currentMessages = [...messages];
	const lastAssistantMsgIdx = currentMessages.findLastIndex((m) => m.role === 'assistant');
	if (lastAssistantMsgIdx === -1) return;

	const messageIdsToRemove = messages.slice(lastAssistantMsgIdx).map((m) => m.id);

	const targetMessageIdx = currentMessages.findIndex((m) => m.id === messageId);
	if (messageIdsToRemove.length !== 1 || targetMessageIdx !== lastAssistantMsgIdx) {
		error = 'Message state is stale, reloading messages from database.';
		await loadActLineMessages(actLineId);
		return;
	}

	messages = messages.slice(0, lastAssistantMsgIdx);

	// Send new response first (persists to DB), then remove old messages
	try {
		await sendMessage(actLineId, { bodyText: undefined, systemPrompt: systemPrompt, narrationContent: narrationContent });
	} catch (err) {
		await log.error('regenerate-last-response', 'Failed to regenerate response', err);
		await loadActLineMessages(actLineId);
		return;
	}

	// Check the NEW message content (last message in array after sendMessage)
	const newMessage = messages.at(-1);
	if (!newMessage?.content) {
		error = 'Regenerated message is empty, reloading messages from database.';
		await loadActLineMessages(actLineId);
		return;
	}

	let removedIds: string[] = [];
	try {
		removedIds = await dbActLines.removeMessagesFromActLine(actLineId, messageIdsToRemove);
	} catch (err) {
		await log.error('regenerate-last-response', 'Old message removal failed', err);
		await loadActLineMessages(actLineId);
	}

	if (removedIds.length > 0) {
		try {
			await removeMemoriesFromActLine(actLineId, removedIds);
		} catch (err) {
			await log.error('regenerate-last-response', 'Memory cleanup failed', err);
		}
	}
}

export async function deleteLastExchange(actLineId: string): Promise<void> {
	let lastUserMsgIdx = messages.length - 1;
	while (lastUserMsgIdx >= 0 && messages[lastUserMsgIdx].role !== 'user') {
		lastUserMsgIdx--;
	}

	if (lastUserMsgIdx === -1) return;
	while (lastUserMsgIdx > 0 && messages[lastUserMsgIdx - 1].role === 'user') {
		lastUserMsgIdx--;
	}

	const messageIdsToRemove = messages.slice(lastUserMsgIdx).map((m) => m.id);
	messages = messages.slice(0, lastUserMsgIdx);

	let removedIds: string[] = [];
	try {
		removedIds = await dbActLines.removeMessagesFromActLine(actLineId, messageIdsToRemove);
	} catch (err) {
		await log.error('delete-last-exchange', 'Message removal failed', err);
		return;
	}

	if (removedIds.length > 0) {
		try {
			await removeMemoriesFromActLine(actLineId, removedIds);
		} catch (err) {
			await log.error('delete-last-exchange', 'Memory cleanup failed', err);
		}
	}
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
		name: userMsg ? `Fork from "${userMsg.content.slice(0, 30)}${userMsg.content.length > 30 ? '...' : ''}"` : 'New Branch',
	};
}

async function removeMemoriesFromActLine(actLineId: string, messageIdsToRemove: string[]) {
	const storyId = getActiveStoryId();
	if (storyId && settings.memoryEnabled) {
		const config = getMemoryProviderConfig();
		if (config) {
			const memory = new Memory(config);
			await memory.deleteByMessages(storyId, actLineId, messageIdsToRemove);
			await memory.deleteLocationsByMessages(storyId, actLineId, messageIdsToRemove);
		}
	}
}
