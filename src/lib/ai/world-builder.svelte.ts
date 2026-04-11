import { getSettings } from '$lib/stores/settings.svelte';
import { createModel } from '$lib/ai/provider';
import { loadWorldBuilderSystemPrompt, loadWorldTemplate } from '$lib/fs/world-prompts';
import { logWorldBuilderChat, generateWorldBuilderLogFilename } from '$lib/logging/chat-logger';
import { executeStream } from '$lib/ai/streaming';

export interface WorldBuilderMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
}

const COMPLETION_MARKER = '[WORLD_BUILDER_COMPLETE]';

let isActive = $state(false);
let messages = $state<WorldBuilderMessage[]>([]);
let isStreaming = $state(false);
let error = $state<string | null>(null);
let storyName = $state<string | null>(null);
let worldContent = $state<string | null>(null);
let isComplete = $state(false);
let abortController: AbortController | null = null;
let logFilePath: string | null = null;

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
}

export function exitWorldBuilderMode(): void {
	if (abortController) {
		abortController.abort();
	}
	resetState();
}

function validateSettings(): string | null {
	const settings = getSettings();
	if (!settings.apiKey || !settings.model) {
		return 'Please configure your API key and model in Settings.';
	}
	return null;
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

	const validationError = validateSettings();
	if (validationError) {
		error = validationError;
		return;
	}

	// Load and cache prompts once
	cachedSystemPrompt = await loadWorldBuilderSystemPrompt();
	cachedWorldTemplate = await loadWorldTemplate();
	const fullSystemPrompt = buildFullSystemPrompt();

	const messageId = crypto.randomUUID();
	const assistantMessage: WorldBuilderMessage = {
		id: messageId,
		role: 'assistant',
		content: ''
	};

	messages = [assistantMessage];
	isStreaming = true;
	abortController = new AbortController();

	try {
		const settings = getSettings();
		const model = createModel(settings);

		const seedMsg = { role: 'user' as const, content: 'I want to create a new story. Please help me build a world.' };
		await logWorldBuilderChat({ systemPrompt: fullSystemPrompt, messages: [seedMsg], logFilename: logFilePath ?? undefined });

		await executeStream(
			{
				model,
				messages: [seedMsg],
				systemPrompt: fullSystemPrompt,
				abortSignal: abortController.signal
			},
			{
				onTextDelta: (text) => {
					const idx = messages.findIndex((m) => m.id === messageId);
					if (idx !== -1) {
						messages[idx] = { ...messages[idx], content: messages[idx].content + text };
					}
				}
			}
		);
	} catch (err: unknown) {
		if (err instanceof DOMException && err.name === 'AbortError') return;
		error = err instanceof Error ? err.message : 'Failed to start world builder.';
		messages = messages.filter((m) => m.id !== messageId);
	} finally {
		isStreaming = false;
		abortController = null;
	}
}

export async function sendWorldBuilderMessage(text: string): Promise<void> {
	const validationError = validateSettings();
	if (validationError) {
		error = validationError;
		return;
	}

	error = null;

	const userMessage: WorldBuilderMessage = {
		id: crypto.randomUUID(),
		role: 'user',
		content: text
	};

	const messageId = crypto.randomUUID();
	messages = [...messages, userMessage, { id: messageId, role: 'assistant', content: '' }];

	await streamNextResponse(messageId);
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

	const messageId = crypto.randomUUID();
	messages = [...messages, { id: messageId, role: 'assistant', content: '' }];
	await streamNextResponse(messageId);
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

	const lastUserIdx = messages.slice(0, lastMessageIdx).map((m) => m.role).lastIndexOf('user');
	if (lastUserIdx === -1) {
		messages = messages.filter((_, i) => i !== lastMessageIdx);
		return;
	}

	messages = messages.filter((_, i) => i !== lastUserIdx && i !== lastMessageIdx);
}

async function streamNextResponse(messageId: string): Promise<void> {
	if (!messages.some((m) => m.id === messageId)) return;

	isStreaming = true;
	abortController = new AbortController();

	try {
		const settings = getSettings();
		const model = createModel(settings);
		const fullSystemPrompt = buildFullSystemPrompt();

		const history = messages
			.filter((m) => m.id !== messageId)
			.map((m) => ({ role: m.role, content: m.content }));

		await logWorldBuilderChat({ systemPrompt: fullSystemPrompt, messages: history, logFilename: logFilePath ?? undefined });

		const result = await executeStream(
			{
				model,
				messages: history,
				systemPrompt: fullSystemPrompt,
				abortSignal: abortController.signal
			},
			{
				onTextDelta: (text) => {
					const idx = messages.findIndex((m) => m.id === messageId);
					if (idx === -1) return;
					messages[idx] = {
						...messages[idx],
						content: messages[idx].content + text
					};
				}
			}
		);

		parseCompletionMarker(result.content);
	} catch (err: unknown) {
		if (err instanceof DOMException && err.name === 'AbortError') return;
		error = err instanceof Error ? err.message : 'An unexpected error occurred.';
		messages = messages.filter((m) => m.id !== messageId);
	} finally {
		isStreaming = false;
		abortController = null;
	}
}
