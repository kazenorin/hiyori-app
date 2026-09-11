import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the streaming layer so no real LLM call is made; `tools` is the 7th argument.
vi.mock('$lib/ai/chat-stream', () => ({
	streamChatResponse: vi.fn(),
}));

// Stub the name tool so the test asserts interview wiring, not name-engine internals.
vi.mock('$lib/ai/tools/suggest-character-name', () => ({
	buildSuggestCharacterNameTools: vi.fn((ctx: unknown) => ({ 'suggest-character-name': { description: 'stub', ctx } })),
}));

vi.mock('$lib/localization', () => ({
	ls: (key: string) => key,
	loadLocaleStrings: vi.fn(async () => {}),
}));

vi.mock('$lib/stores/settings.svelte', () => ({
	settings: { locale: 'en', targetWordCount: 400 },
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

// Keep interview transcript persistence out of the database.
vi.mock('$lib/db/messages', () => ({
	createMessage: vi.fn(async () => {}),
}));

vi.mock('$lib/db/act-lines', () => ({
	getNextPremisesSequence: vi.fn(async () => 1),
	addMessageToPremises: vi.fn(async () => {}),
	getPremisesMessages: vi.fn(async () => []),
	getActLine: vi.fn(async () => null),
	removeMessagesFromPremises: vi.fn(async () => {}),
}));

import { enterActPlotInterviewMode, enterWorldBuilderMode, exitWorldBuilderMode } from '$lib/features/world-builder/world-builder.svelte';
import { streamChatResponse } from '$lib/ai/chat-stream';
import { buildSuggestCharacterNameTools } from '$lib/ai/tools/suggest-character-name';
import { createStreamAccumulator } from '$lib/ai/chat-callbacks';
import type { StreamResultMetadata } from '$lib/ai/streaming';
import type { ToolSet } from 'ai';

const metadata: StreamResultMetadata = {
	finishReason: 'stop',
	usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
	durationMs: 10,
	models: new Set(['test-model']),
};

/** Resolve the stream immediately so the interview turn finishes without a provider. */
function stubStream(): void {
	(streamChatResponse as ReturnType<typeof vi.fn>).mockImplementation(async (_s, _h, _sig, onUpdate) => {
		const accumulator = createStreamAccumulator(onUpdate);
		accumulator.callbacks.onComplete(metadata);
		return accumulator;
	});
}

const streamToolNames = (): string[] => {
	const calls = (streamChatResponse as ReturnType<typeof vi.fn>).mock.calls;
	const tools = calls[calls.length - 1][6] as ToolSet | undefined;
	return tools ? Object.keys(tools) : [];
};

describe('interview tool exposure', () => {
	beforeEach(() => {
		exitWorldBuilderMode();
		vi.clearAllMocks();
		stubStream();
	});

	it('gives the act-plot interview the suggest-character-name tool alongside record-requirement', async () => {
		const storyRow = { id: 'story-1', name: 'Story One', locale: 'en', createdAt: 0, updatedAt: 0 };

		await enterActPlotInterviewMode({ actLineId: 'line-1', worldContent: '# World', story: storyRow });

		expect(streamToolNames()).toEqual(expect.arrayContaining(['record-requirement', 'suggest-character-name']));
		// The tool resolves its prompt override from the story, so it must receive the row.
		expect(buildSuggestCharacterNameTools).toHaveBeenCalledWith({ story: storyRow });
	});

	it('omits suggest-character-name from the act-plot interview when no story context exists', async () => {
		await enterActPlotInterviewMode({ actLineId: 'line-1', worldContent: '# World' });

		expect(streamToolNames()).not.toContain('suggest-character-name');
		expect(buildSuggestCharacterNameTools).not.toHaveBeenCalled();
	});

	it('keeps suggest-character-name out of the world-builder interview', async () => {
		await enterWorldBuilderMode();

		expect(streamToolNames()).toContain('record-requirement');
		expect(streamToolNames()).not.toContain('suggest-character-name');
	});
});
