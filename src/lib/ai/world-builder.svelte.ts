import { streamText } from 'ai';
import { getSettings } from '$lib/stores/settings.svelte';
import { createModel } from '$lib/ai/provider';
import { loadWorldBuilderSystemPrompt, loadWorldTemplate } from '$lib/fs/world-prompts';
import { logWorldBuilderChat } from '$lib/logging/chat-logger';

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

export function exitWorldBuilderMode(): void {
	if (abortController) {
		abortController.abort();
	}
	isActive = false;
	messages = [];
	isStreaming = false;
	error = null;
	storyName = null;
	worldContent = null;
	isComplete = false;
	abortController = null;
}

export async function enterWorldBuilderMode(): Promise<void> {
	exitWorldBuilderMode();
	isActive = true;

	const settings = getSettings();
	if (!settings.apiKey || !settings.model) {
		error = 'Please configure your API key and model in Settings.';
		return;
	}

	const systemPrompt = await loadWorldBuilderSystemPrompt();
	const worldTemplate = await loadWorldTemplate();
	const fullSystemPrompt = systemPrompt + '\n\n---\n\n' + worldTemplate + '\n\n---\n\n';

	const assistantId = crypto.randomUUID();
	const assistantMessage: WorldBuilderMessage = {
		id: assistantId,
		role: 'assistant',
		content: ''
	};

	messages = [assistantMessage];
	isStreaming = true;
	abortController = new AbortController();

	try {
		const model = createModel(settings);

		// Seed with a minimal user message to trigger the greeting
		const seedMsg = { role: 'user' as const, content: 'I want to create a new story. Please help me build a world.' };
		await logWorldBuilderChat({ systemPrompt: fullSystemPrompt, messages: [seedMsg] });

		const result = streamText({
			model,
			messages: [seedMsg],
			system: fullSystemPrompt,
			abortSignal: abortController.signal
		});

		for await (const part of result.fullStream) {
			if (part.type === 'text-delta') {
				messages = messages.map((m) =>
					m.id === assistantId ? { ...m, content: m.content + part.text } : m
				);
			}
		}
	} catch (err: unknown) {
		if (err instanceof DOMException && err.name === 'AbortError') return;
		error = err instanceof Error ? err.message : 'Failed to start world builder.';
		messages = messages.filter((m) => m.id !== assistantId);
	} finally {
		isStreaming = false;
		abortController = null;
	}
}

export async function sendWorldBuilderMessage(text: string): Promise<void> {
	const settings = getSettings();
	if (!settings.apiKey || !settings.model) {
		error = 'Please configure your API key and model in Settings.';
		return;
	}

	error = null;

	const userMessage: WorldBuilderMessage = {
		id: crypto.randomUUID(),
		role: 'user',
		content: text
	};

	const assistantId = crypto.randomUUID();
	const assistantMessage: WorldBuilderMessage = {
		id: assistantId,
		role: 'assistant',
		content: ''
	};

	messages = [...messages, userMessage, assistantMessage];
	isStreaming = true;
	abortController = new AbortController();

	try {
		const systemPrompt = await loadWorldBuilderSystemPrompt();
		const worldTemplate = await loadWorldTemplate();
		const fullSystemPrompt = systemPrompt + '\n\n## World Template\n\n' + worldTemplate;
		const model = createModel(settings);

		const history = messages
			.filter((m) => m.id !== assistantId)
			.map((m) => ({ role: m.role, content: m.content }));

		await logWorldBuilderChat({ systemPrompt: fullSystemPrompt, messages: history });

		const result = streamText({
			model,
			messages: history,
			system: fullSystemPrompt,
			abortSignal: abortController.signal
		});

		for await (const part of result.fullStream) {
			if (part.type === 'text-delta') {
				messages = messages.map((m) =>
					m.id === assistantId ? { ...m, content: m.content + part.text } : m
				);
			}
		}

		// Check for completion marker in the final assistant message
		const finalContent = messages.find((m) => m.id === assistantId)?.content ?? '';
		const markerIndex = finalContent.indexOf(COMPLETION_MARKER);
		if (markerIndex !== -1) {
			const afterMarker = finalContent.slice(markerIndex + COMPLETION_MARKER.length).trim();
			const lines = afterMarker.split('\n');

			const extractedName = (lines[0] ?? '').trim() || 'Untitled Story';
			const extractedContent = lines.slice(1).join('\n').trim();

			if (extractedContent) {
				storyName = extractedName;
				worldContent = extractedContent;
				isComplete = true;
			}
		}
	} catch (err: unknown) {
		if (err instanceof DOMException && err.name === 'AbortError') return;
		error = err instanceof Error ? err.message : 'An unexpected error occurred.';
		messages = messages.filter((m) => m.id !== assistantId);
	} finally {
		isStreaming = false;
		abortController = null;
	}
}

export function stopStreaming(): void {
	abortController?.abort();
}
