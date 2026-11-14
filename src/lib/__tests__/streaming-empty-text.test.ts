import { describe, it, expect, vi, beforeEach } from 'vitest';

// streamText is mocked so executeStream runs without a real LLM. The mock
// returns an empty stream (no parts) and empty final text — the quiet-run shape.
vi.mock('ai', () => ({
	streamText: vi.fn(),
	isStepCount: vi.fn((n: number) => n),
}));
vi.mock('#lib/stores/settings.svelte.ts', () => ({
	getSettings: () => ({ llmStreamLogInputMessages: false, llmStreamLogCompletedResponse: false }),
}));
vi.mock('#lib/logging/logger.ts', () => ({ fileLog: vi.fn(async () => {}) }));

import { streamText } from 'ai';
import { executeStream, type StreamConfig, type StreamResultMetadata } from '#lib/ai/streaming.ts';

function mockEmptyStream(): void {
	vi.mocked(streamText).mockReturnValue({
		stream: (async function* () {})(),
		usage: Promise.resolve({ inputTokens: 1, outputTokens: 0, totalTokens: 1 }),
		finishReason: Promise.resolve('stop'),
		text: Promise.resolve(''),
	} as never);
}

function makeConfig(overrides: Partial<StreamConfig> = {}): StreamConfig {
	return {
		model: {} as never,
		messages: [],
		systemPrompt: 'sys',
		abortSignal: new AbortController().signal,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockEmptyStream();
});

describe('executeStream empty-text handling', () => {
	it('fails an empty response by default (existing behavior)', async () => {
		const onComplete = vi.fn();
		const onError = vi.fn();
		await executeStream(makeConfig(), { onTextDelta: vi.fn(), onComplete, onError });
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onComplete).not.toHaveBeenCalled();
	});

	it('completes an empty response when allowEmptyText is set (quiet tool-only run)', async () => {
		// WHY: the changed-only compressor may emit zero tool calls and zero text;
		// that is a legitimate no-change outcome, not a stream failure.
		const onComplete = vi.fn();
		const onError = vi.fn();
		await executeStream(makeConfig({ allowEmptyText: true }), { onTextDelta: vi.fn(), onComplete, onError });
		expect(onError).not.toHaveBeenCalled();
		expect(onComplete).toHaveBeenCalledTimes(1);
		const metadata: StreamResultMetadata = onComplete.mock.calls[0][0];
		expect(metadata.finishReason).toBe('stop');
	});
});
