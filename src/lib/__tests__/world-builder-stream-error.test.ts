import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the streaming layer so no real LLM call is made
vi.mock('$lib/ai/chat-stream', () => ({
	streamChatResponse: vi.fn(),
}));

vi.mock('$lib/stores/settings.svelte', () => ({
	settings: { locale: 'en' },
	getMainProviderConfig: vi.fn(() => ({
		id: 'test',
		name: 'Test Provider',
		provider: 'openai',
		apiType: 'responses',
		baseURL: 'http://localhost:11434/v1',
		apiKey: 'test-key',
		model: 'test-model',
	})),
	getProviderOptions: vi.fn(() => ({})),
}));

vi.mock('$lib/logging/chat-logger', () => ({
	logWorldBuilderChat: vi.fn(async () => {}),
	generateWorldBuilderLogFilename: vi.fn(() => 'wb-test.log'),
}));

vi.mock('$lib/fs/prompts', () => {
	const loader = () => ({ loadDefault: vi.fn(async () => 'prompt'), loadByStory: vi.fn(async () => 'prompt') });
	return {
		actPlotInterviewSystemPromptLoader: loader(),
		generalInstructionsLoader: loader(),
		worldBuilderSystemPromptLoader: loader(),
		worldPreTemplateDiscoveryLoader: loader(),
		highFantasyTemplateLoader: loader(),
		modernSliceOfLifeTemplateLoader: loader(),
		sciFiTemplateLoader: loader(),
		urbanFantasyTemplateLoader: loader(),
	};
});

import { sendWorldBuilderMessage, getError, getMessages, exitWorldBuilderMode } from '$lib/features/world-builder/world-builder.svelte';
import { streamChatResponse } from '$lib/ai/chat-stream';
import { createStreamAccumulator } from '$lib/ai/chat-callbacks';
import type { StreamResultMetadata } from '$lib/ai/streaming';
import { ERR_PROVIDER_UNREACHABLE } from '$lib/definitions/error-messages';

const metadata: StreamResultMetadata = {
	finishReason: 'stop',
	usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
	durationMs: 10,
	models: new Set(['test-model']),
};

/** Simulate executeStream behavior: errors are delivered via callbacks, never thrown. */
function mockStreamError(streamError: Error): void {
	(streamChatResponse as ReturnType<typeof vi.fn>).mockImplementation(async (_sys, _hist, _signal, onUpdate) => {
		const accumulator = createStreamAccumulator(onUpdate);
		accumulator.callbacks.onError(streamError);
		return accumulator;
	});
}

function mockStreamSuccess(content: string): void {
	(streamChatResponse as ReturnType<typeof vi.fn>).mockImplementation(async (_sys, _hist, _signal, onUpdate) => {
		const accumulator = createStreamAccumulator(onUpdate);
		accumulator.callbacks.onTextDelta(content);
		accumulator.callbacks.onComplete(metadata);
		return accumulator;
	});
}

describe('world builder stream error handling', () => {
	beforeEach(() => {
		exitWorldBuilderMode();
		vi.clearAllMocks();
	});

	it('surfaces a provider-unreachable error and removes the empty message when the provider cannot be reached', async () => {
		mockStreamError(new Error('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:11434') }));

		await sendWorldBuilderMessage('hello');

		expect(getError()).toBe(ERR_PROVIDER_UNREACHABLE);
		// The empty assistant placeholder must be removed; only the user message remains
		const messages = getMessages();
		expect(messages).toHaveLength(1);
		expect(messages[0].role).toBe('user');
	});

	it('surfaces non-network errors and removes the empty message', async () => {
		mockStreamError(new Error('something went wrong'));

		await sendWorldBuilderMessage('hello');

		expect(getError()).toBe('something went wrong');
		expect(getMessages()).toHaveLength(1);
	});

	it('keeps the assistant message and sets no error on success', async () => {
		mockStreamSuccess('Hi there!');

		await sendWorldBuilderMessage('hello');

		expect(getError()).toBeNull();
		const messages = getMessages();
		expect(messages).toHaveLength(2);
		expect(messages[1].role).toBe('assistant');
		expect(messages[1].content).toContain('Hi there!');
	});
});
