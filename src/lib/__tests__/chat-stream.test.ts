import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamWithRetry, DEFAULT_RETRY_CONFIG } from '../ai/chat-stream';
import type { StreamResultMetadata } from '../ai/streaming';
import type { ProviderConfig } from '../stores/settings.svelte';

// Mock executeStream so streamChatResponse works without a real LLM
vi.mock('../ai/streaming', () => ({
	executeStream: vi.fn(),
}));

// Mock createModel so streamChatResponse doesn't need real provider config
vi.mock('../ai/provider', () => ({
	createModel: vi.fn(),
}));

// Mock getMainProviderConfig
vi.mock('../stores/settings.svelte', () => ({
	getMainProviderConfig: vi.fn(() => ({
		provider: 'openai',
		apiKey: 'test-key',
		model: 'gpt-4',
	})),
}));

const { executeStream } = vi.mocked(await import('../ai/streaming'));

const defaultMetadata: StreamResultMetadata = {
	finishReason: 'stop',
	usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
	durationMs: 100,
	models: new Set(['gpt-4']),
};

function setupStreamSuccess(metadata: StreamResultMetadata = defaultMetadata): void {
	(executeStream as ReturnType<typeof vi.fn>).mockImplementation(
		async (_config: unknown, callbacks: { onComplete: (m: StreamResultMetadata) => void }) => {
			callbacks.onComplete(metadata);
		}
	);
}

function setupStreamError(error: Error): void {
	(executeStream as ReturnType<typeof vi.fn>).mockImplementation(async (_config: unknown, callbacks: { onError: (e: Error) => void }) => {
		callbacks.onError(error);
	});
}

const providerConfig: ProviderConfig = {
	id: 'test',
	name: 'Test Provider',
	provider: 'openai',
	apiType: 'responses',
	baseURL: '',
	apiKey: 'test-key',
	model: 'gpt-4',
};

describe('streamWithRetry', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupStreamSuccess();
	});

	it('succeeds on first attempt', async () => {
		const result = await streamWithRetry('system', [], {
			retryConfig: DEFAULT_RETRY_CONFIG,
			onProgress: vi.fn(),
			onError: vi.fn(),
			providerConfig,
		});

		expect(result.state.content).toBe('');
		expect(executeStream).toHaveBeenCalledTimes(1);
	});

	it('retries on mid-stream error and succeeds', async () => {
		const onError = vi.fn();
		const onRetry = vi.fn();

		let callCount = 0;
		(executeStream as ReturnType<typeof vi.fn>).mockImplementation(
			async (_config: unknown, callbacks: { onComplete: (m: StreamResultMetadata) => void; onError: (e: Error) => void }) => {
				callCount++;
				if (callCount === 1) {
					callbacks.onError(new Error('Stream failed'));
				} else {
					callbacks.onComplete(defaultMetadata);
				}
			}
		);

		const result = await streamWithRetry('system', [], {
			retryConfig: { retryCount: 2, backoffIntervalSeconds: 0 },
			onProgress: vi.fn(),
			onError,
			providerConfig,
			onRetry,
		});

		expect(result.state.content).toBe('');
		expect(executeStream).toHaveBeenCalledTimes(2);
		// onError called once from the catch block (attempt 1 failed)
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onRetry).toHaveBeenCalledWith(1, 3);
	});

	it('throws on auth error without retrying', async () => {
		setupStreamError(new Error('401 Unauthorized'));

		await expect(
			streamWithRetry('system', [], {
				retryConfig: DEFAULT_RETRY_CONFIG,
				onProgress: vi.fn(),
				onError: vi.fn(),
				providerConfig,
			})
		).rejects.toThrow('Authentication failed');

		expect(executeStream).toHaveBeenCalledTimes(1);
	});

	it('throws last error after exhausting retries', async () => {
		setupStreamError(new Error('Persistent failure'));

		const onError = vi.fn();

		await expect(
			streamWithRetry('system', [], {
				retryConfig: { retryCount: 2, backoffIntervalSeconds: 0 },
				onProgress: vi.fn(),
				onError,
				providerConfig,
			})
		).rejects.toThrow('Persistent failure');

		// retryCount=2 means 3 total attempts
		expect(executeStream).toHaveBeenCalledTimes(3);
		// onError called for retryable attempts (not the final throw)
		expect(onError).toHaveBeenCalledTimes(2);
	});

	it('calls onRetry with correct attempt numbers', async () => {
		const onRetry = vi.fn();
		let callCount = 0;
		(executeStream as ReturnType<typeof vi.fn>).mockImplementation(
			async (_config: unknown, callbacks: { onComplete: (m: StreamResultMetadata) => void; onError: (e: Error) => void }) => {
				callCount++;
				if (callCount <= 2) {
					callbacks.onError(new Error(`Fail ${callCount}`));
				} else {
					callbacks.onComplete(defaultMetadata);
				}
			}
		);

		await streamWithRetry('system', [], {
			retryConfig: { retryCount: 2, backoffIntervalSeconds: 0 },
			onProgress: vi.fn(),
			onError: vi.fn(),
			providerConfig,
			onRetry,
		});

		expect(onRetry).toHaveBeenCalledTimes(2);
		expect(onRetry).toHaveBeenNthCalledWith(1, 1, 3);
		expect(onRetry).toHaveBeenNthCalledWith(2, 2, 3);
	});

	it('throws immediately when abort signal is already set', async () => {
		const abortController = new AbortController();
		abortController.abort();

		await expect(
			streamWithRetry('system', [], {
				retryConfig: { retryCount: 2, backoffIntervalSeconds: 0 },
				onProgress: vi.fn(),
				onError: vi.fn(),
				providerConfig,
				abortSignal: abortController.signal,
			})
		).rejects.toThrow();

		// Should not attempt any calls
		expect(executeStream).not.toHaveBeenCalled();
	});
});

describe('DEFAULT_RETRY_CONFIG', () => {
	it('has expected defaults', () => {
		expect(DEFAULT_RETRY_CONFIG.retryCount).toBe(2);
		expect(DEFAULT_RETRY_CONFIG.backoffIntervalSeconds).toBe(2);
	});
});
