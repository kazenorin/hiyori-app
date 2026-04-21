import { getMainProviderConfig, type ProviderConfig } from '$lib/stores/settings.svelte';
import { loadWorldBuilderSystemPrompt, loadWorldTemplate, loadInterviewExtractionPrompt } from '$lib/fs/prompts';
import { generateWorldBuilderLogFilename, logWorldBuilderChat } from '$lib/logging/chat-logger';
import { log } from '$lib/logging/logger';
import { type StreamAccumulator, type StreamState } from '$lib/ai/chat-callbacks';
import { streamChatResponse } from './chat-stream';
import * as dbMessages from '$lib/db/messages';
import * as dbActLines from '$lib/db/act-lines';
import type {Message} from "$lib/ai/chat.svelte";

export interface WorldBuilderMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
}

const COMPLETION_MARKER = '[WORLD_BUILDER_COMPLETE]';
const seedMsg = { role: 'user' as const, content: 'I want to create a new story. Please help me build a world.' };

let isActive = $state(false);
let messages = $state<WorldBuilderMessage[]>([]);
let isStreaming = $state(false);
let error = $state<string | null>(null);
let storyName = $state<string | null>(null);
let worldContent = $state<string | null>(null);
let isComplete = $state(false);
let abortController: AbortController | null = null;
let logFilePath: string | null = null;

// Act-plot interview state
let actPlotInterview = $state(false);
let interviewActLineId: string | null = null;
let interviewSystemPrompt: string | null = null;

// Cached prompts loaded once on enter
let cachedSystemPrompt: string | null = null;
let cachedWorldTemplate: string | null = null;

export function getIsActive(): boolean {
	return isActive;
}
export function getMessages(): WorldBuilderMessage[] {
	return messages;
}
export function getIsStreaming(): boolean {
	return isStreaming;
}
export function getError(): string | null {
	return error;
}
export function getStoryName(): string | null {
	return storyName;
}
export function getWorldContent(): string | null {
	return worldContent;
}
export function getIsComplete(): boolean {
	return isComplete;
}
export function getLogFilePath(): string | null {
	return logFilePath;
}
export function getActPlotInterview(): boolean {
	return actPlotInterview;
}
export function getInterviewActLineId(): string | null {
	return interviewActLineId;
}

function resetState(): void {
	isActive = false;
	messages = [];
	isStreaming = false;
	error = null;
	storyName = null;
	worldContent = null;
	isComplete = false;
	abortController = null;
	logFilePath = null;
	cachedSystemPrompt = null;
	cachedWorldTemplate = null;
	actPlotInterview = false;
	interviewActLineId = null;
	interviewSystemPrompt = null;
}

export function exitWorldBuilderMode(): void {
	if (abortController) {
		abortController.abort();
	}
	resetState();
}

function buildFullSystemPrompt(): string {
	return (cachedSystemPrompt ?? '') + '\n\n---\n\n' + (cachedWorldTemplate ?? '') + '\n\n---\n\n';
}

/**
 * Pure function to extract completion data from content.
 * Returns { storyName, worldContent } or null if no marker found.
 */
export function extractCompletionData(content: string): { storyName: string; worldContent: string } | null {
	const markerIndex = content.indexOf(COMPLETION_MARKER);
	if (markerIndex === -1) return null;

	const afterMarker = content.slice(markerIndex + COMPLETION_MARKER.length).trim();
	const lines = afterMarker.split('\n');

	const extractedName = (lines[0] ?? '').trim() || 'Untitled Story';
	const extractedContent = lines.slice(1).join('\n').trim();

	if (!extractedContent) return null;
	return { storyName: extractedName, worldContent: extractedContent };
}

function parseCompletionMarker(content: string): void {
	const result = extractCompletionData(content);
	if (result) {
		storyName = result.storyName;
		worldContent = result.worldContent;
		isComplete = true;
	}
}

export async function enterWorldBuilderMode(): Promise<void> {
	exitWorldBuilderMode();
	isActive = true;
	logFilePath = generateWorldBuilderLogFilename();

	// Load and cache prompts once
	cachedSystemPrompt = await loadWorldBuilderSystemPrompt();
	cachedWorldTemplate = await loadWorldTemplate();

	await streamNextResponse();
}

export async function enterActPlotInterviewMode(actLineId: string, systemPrompt: string): Promise<void> {
	// Reset world builder state but keep isActive true
	resetState();
	isActive = true;
	actPlotInterview = true;
	interviewActLineId = actLineId;
	interviewSystemPrompt = systemPrompt;

	// Load interview extraction prompt
	const interviewPrompt = await loadInterviewExtractionPrompt();

	// Send the interview prompt as the first message (hidden user message to guide narrator)
	const seedMessage: WorldBuilderMessage = {
		id: crypto.randomUUID(),
		role: 'user',
		content: interviewPrompt,
	};

	await streamNextResponse(seedMessage);
}

export async function sendWorldBuilderMessage(text: string): Promise<void> {
	error = null;

	const userMessage: WorldBuilderMessage = {
		id: crypto.randomUUID(),
		role: 'user',
		content: text,
	};

	await streamNextResponse(userMessage);
}

export function stopStreaming(): void {
	abortController?.abort();
}

export async function regenerateLastWorldBuilderResponse(): Promise<void> {
	if (isStreaming) return;

	const lastMessageIdx = messages.map((m) => m.role).lastIndexOf('assistant');
	if (lastMessageIdx === -1) return;

	const lastAssistant = messages[lastMessageIdx];
	messages = messages.filter((m) => m.id !== lastAssistant.id);

	await streamNextResponse();
}

export async function deleteLastWorldBuilderExchange(): Promise<void> {
	if (isStreaming) return;

	const lastMessageIdx = messages.map((m) => m.role).lastIndexOf('assistant');
	if (lastMessageIdx === -1) {
		// No assistant message — remove last user message if any
		const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user');
		if (lastUserIdx === -1) return;
		messages = messages.filter((_, i) => i !== lastUserIdx);
		return;
	}

	const lastUserIdx = messages
		.slice(0, lastMessageIdx)
		.map((m) => m.role)
		.lastIndexOf('user');
	if (lastUserIdx === -1) {
		messages = messages.filter((_, i) => i !== lastMessageIdx);
		return;
	}

	messages = messages.filter((_, i) => i !== lastUserIdx && i !== lastMessageIdx);
}

async function streamNextResponse(userMessage?: WorldBuilderMessage): Promise<void> {
	const providerConfig = getMainProviderConfig();
	if (!providerConfig?.apiKey || !providerConfig?.model) {
		error = 'Please configure your API key and model in Settings.';
		return;
	}

	const responseMessage: WorldBuilderMessage = { id: crypto.randomUUID(), role: 'assistant', content: '' };
	if (userMessage) {
		messages = [...messages, userMessage, responseMessage];
	} else {
		messages = [...messages, responseMessage];
	}

	const messageIdx = messages.length - 1;
	function getCurrentMessage(): Message {
		return messages[messageIdx];
	}

	isStreaming = true;
	abortController = new AbortController();

	try {
		const existingMsgs = messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
		const history = actPlotInterview ? existingMsgs : [seedMsg, ...existingMsgs];
		await streamWorldBuilderChat(history, messageIdx, abortController.signal, providerConfig);
		parseCompletionMarker(getCurrentMessage().content);

		// Persist messages to DB when in interview mode
		if (actPlotInterview && interviewActLineId) {
			await persistInterviewMessages(userMessage, getCurrentMessage());
		}
	} catch (err: unknown) {
		if (err instanceof DOMException && err.name === 'AbortError') {
			// Persist partial content on abort in interview mode
			if (actPlotInterview && interviewActLineId) {
				const partial = getCurrentMessage();
				if (partial?.content) {
					await persistInterviewMessages(userMessage, partial);
				}
			}
			return;
		}
		error = err instanceof Error ? err.message : 'An unexpected error occurred.';
		messages = messages.filter((m) => m.id !== responseMessage.id);
	} finally {
		isStreaming = false;
		abortController = null;
	}
}

async function persistInterviewMessages(
	userMessage: WorldBuilderMessage | undefined,
	assistantMessage: WorldBuilderMessage
): Promise<void> {
	if (!interviewActLineId) return;

	try {
		if (userMessage) {
			await dbMessages.createMessage(userMessage.id, userMessage.role, userMessage.content);
			const userSeq = await dbActLines.getNextPremisesSequence(interviewActLineId);
			await dbActLines.addMessageToPremises(interviewActLineId, userMessage.id, userSeq);
		}

		if (assistantMessage.content) {
			await dbMessages.createMessage(assistantMessage.id, 'assistant', assistantMessage.content);
			const assistantSeq = await dbActLines.getNextPremisesSequence(interviewActLineId);
			await dbActLines.addMessageToPremises(interviewActLineId, assistantMessage.id, assistantSeq);
		}
	} catch (err) {
		await log.error('interview', 'Failed to persist interview messages', err);
	}
}

async function streamWorldBuilderChat(
	history: { role: 'user' | 'assistant'; content: string }[],
	messageIdx: number,
	abortSignal: AbortSignal,
	providerConfig: ProviderConfig
): Promise<StreamAccumulator> {
	const fullSystemPrompt = actPlotInterview && interviewSystemPrompt ? interviewSystemPrompt : buildFullSystemPrompt();
	const result = await Promise.all([
		logWorldBuilderChat({
			systemPrompt: fullSystemPrompt,
			messages: history,
			logFilename: logFilePath ?? undefined,
		}),
		streamChatResponse(
			fullSystemPrompt,
			history,
			abortSignal,
			(state: StreamState) => {
				messages[messageIdx] = { ...messages[messageIdx], content: state.content };
			},
			() => {},
			providerConfig
		),
	]);
	return result[1];
}
