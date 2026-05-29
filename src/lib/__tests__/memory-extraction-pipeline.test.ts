import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtractedMemories } from '$lib/features/memory/memory-extract-parser';

// Mock Memory class — must use regular function for constructor
const mockMemoryInstance = {
	add: vi.fn(async () => 1),
	addLocation: vi.fn(async () => true),
};

vi.mock('$lib/features/memory', () => ({
	Memory: vi.fn(function () {
		return mockMemoryInstance;
	}),
}));

// Mock AI SDK
const mockGenerateText = vi.fn(async () => ({ text: '## elena\n\n### tavern\n- Elena sat.' }));
vi.mock('ai', () => ({
	generateText: mockGenerateText,
}));

// Mock provider
vi.mock('$lib/ai/provider', () => ({
	createModel: vi.fn(() => ({})),
}));

// Mock settings
const defaultProviderConfig = {
	id: 'test-provider',
	name: 'Test',
	provider: 'openai' as const,
	apiType: 'responses' as const,
	baseURL: 'https://api.openai.com/v1',
	model: 'gpt-4o',
	apiKey: 'sk-test',
};
const mockGetMemoryProviderConfig = vi.fn(() => defaultProviderConfig);
const mockGetEmbeddingProviderConfig = vi.fn(() => defaultProviderConfig);
vi.mock('$lib/stores/settings.svelte', () => ({
	getMemoryProviderConfig: mockGetMemoryProviderConfig,
	getEmbeddingProviderConfig: mockGetEmbeddingProviderConfig,
}));

// Mock prompts
vi.mock('$lib/fs/prompts', () => ({
	memoryExtractionSystemPromptLoader: { loadByStory: vi.fn(), loadDefault: vi.fn(async () => 'System prompt') },
	memoryExtractionPromptLoader: { loadByStory: vi.fn(), loadDefault: vi.fn(async () => 'User prompt') },
}));

// Mock parser — typed as returning ExtractedMemories
const mockParseMemoryExtract = vi.fn<(text: string) => ExtractedMemories>();
vi.mock('$lib/features/memory/memory-extract-parser', () => ({
	parseMemoryExtract: mockParseMemoryExtract,
}));

// Mock async utilities - mock withRetry with same logic but no actual delays
const mockIsAuthError = vi.fn((err: Error) => {
	const msg = err.message.toLowerCase();
	return msg.includes('401') || msg.includes('403') || msg.includes('unauthorized');
});
const mockSleep = vi.fn(async (_ms?: number) => {});

// Custom mock withRetry that mimics real behavior but with zero-delay
async function mockWithRetry<T>(
	fn: () => Promise<T>,
	options: {
		maxAttempts: number;
		backoffMs: number;
		shouldRetry?: (error: Error) => boolean;
		onRetry?: (attempt: number, error: Error) => void | Promise<void>;
	}
): Promise<T> {
	let lastError: Error | undefined;

	for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));

			if (options.shouldRetry && !options.shouldRetry(lastError)) {
				throw lastError;
			}

			const isLastAttempt = attempt === options.maxAttempts - 1;
			if (isLastAttempt) {
				break;
			}

			if (options.onRetry) {
				await options.onRetry(attempt + 1, lastError);
			}

			// Zero delay for tests (no actual sleep)
			await mockSleep(options.backoffMs * (attempt + 1));
		}
	}

	throw lastError ?? new Error('Retry failed');
}

vi.mock('$lib/utils/async', () => ({
	isAuthError: mockIsAuthError,
	sleep: mockSleep,
	toError: (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
	withRetry: mockWithRetry,
}));

// Mock logger
vi.mock('$lib/logging/logger', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {}),
	},
}));

const defaultParsed: ExtractedMemories = {
	elena: { locations: { tavern: ['Elena sat by the fire.'] } },
};

describe('memory-extraction-pipeline', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Restore default mock implementations
		mockGetMemoryProviderConfig.mockReturnValue(defaultProviderConfig);
		mockGetEmbeddingProviderConfig.mockReturnValue(defaultProviderConfig);
		mockGenerateText.mockResolvedValue({ text: '## elena\n\n### tavern\n- Elena sat.' });
		mockParseMemoryExtract.mockReturnValue(defaultParsed);
		mockIsAuthError.mockImplementation((err: Error) => {
			const msg = err.message.toLowerCase();
			return msg.includes('401') || msg.includes('403') || msg.includes('unauthorized');
		});
		mockMemoryInstance.add.mockResolvedValue(1);
		mockMemoryInstance.addLocation.mockResolvedValue(true);
	});

	describe('runMemoryExtractionPipeline', () => {
		it('runs full pipeline successfully', async () => {
			const { runMemoryExtractionPipeline } = await import('$lib/features/memory/memory-extraction-pipeline');
			const result = await runMemoryExtractionPipeline('Elena walked into the tavern.', 'story-1', 'line-1', 'msg-1');

			expect(mockGenerateText).toHaveBeenCalledWith(
				expect.objectContaining({
					system: 'System prompt',
					prompt: expect.stringContaining('User prompt'),
				})
			);

			expect(mockMemoryInstance.add).toHaveBeenCalledWith('story-1', 'line-1', 'msg-1', 'elena', 'tavern', ['Elena sat by the fire.']);
			expect(mockMemoryInstance.addLocation).toHaveBeenCalledWith('story-1', 'line-1', 'msg-1', 'tavern');
			expect(result.charactersProcessed).toBe(1);
			expect(result.memoriesAdded).toBe(1);
			expect(result.locationsAdded).toBe(1);
		});

		it('throws when no provider configured', async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			mockGetMemoryProviderConfig.mockReturnValue(undefined as any);

			const { runMemoryExtractionPipeline } = await import('$lib/features/memory/memory-extraction-pipeline');
			await expect(runMemoryExtractionPipeline('response', 'story-1', 'line-1', 'msg-1')).rejects.toThrow('Memory provider not configured');
		});

		it('throws when no embedding provider configured', async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			mockGetEmbeddingProviderConfig.mockReturnValue(undefined as any);

			const { runMemoryExtractionPipeline } = await import('$lib/features/memory/memory-extraction-pipeline');
			await expect(runMemoryExtractionPipeline('response', 'story-1', 'line-1', 'msg-1')).rejects.toThrow(
				'Embedding provider not configured'
			);
		});

		it('throws immediately on auth error without retry', async () => {
			mockGenerateText.mockRejectedValueOnce(new Error('401 Unauthorized'));

			const { runMemoryExtractionPipeline } = await import('$lib/features/memory/memory-extraction-pipeline');
			await expect(runMemoryExtractionPipeline('response', 'story-1', 'line-1', 'msg-1')).rejects.toThrow('401 Unauthorized');
			expect(mockGenerateText).toHaveBeenCalledTimes(1); // No retries for auth errors
		});

		it('retries on transient errors', async () => {
			mockGenerateText
				.mockRejectedValueOnce(new Error('Network error'))
				.mockRejectedValueOnce(new Error('Timeout'))
				.mockResolvedValueOnce({ text: '## elena\n\n### tavern\n- Elena sat.' });

			const { runMemoryExtractionPipeline } = await import('$lib/features/memory/memory-extraction-pipeline');
			const result = await runMemoryExtractionPipeline('response', 'story-1', 'line-1', 'msg-1');

			expect(mockGenerateText).toHaveBeenCalledTimes(3);
			expect(mockSleep).toHaveBeenCalledTimes(2);
			expect(result.charactersProcessed).toBe(1);
		});

		it('throws after max retries on persistent failure', async () => {
			mockGenerateText.mockRejectedValue(new Error('Network error'));

			const { runMemoryExtractionPipeline } = await import('$lib/features/memory/memory-extraction-pipeline');
			await expect(runMemoryExtractionPipeline('response', 'story-1', 'line-1', 'msg-1')).rejects.toThrow('Network error');

			expect(mockGenerateText).toHaveBeenCalledTimes(4); // Initial + 3 retries
		});
	});

	describe('persistMemoriesWithRetry', () => {
		it('persists all characters and locations', async () => {
			mockParseMemoryExtract.mockReturnValue({
				elena: {
					locations: {
						tavern: ['Memory 1', 'Memory 2'],
						forest: ['Memory 3'],
					},
				},
				marcus: {
					locations: {
						castle: ['Memory 4'],
					},
				},
			});

			// Mock add to return the number of memories passed (simulating dedup where all are unique)
			mockMemoryInstance.add.mockImplementation(async (...args: unknown[]) => {
				const memories = args[5] as string[];
				return memories.length;
			});
			mockMemoryInstance.addLocation.mockResolvedValue(true);

			const { runMemoryExtractionPipeline } = await import('$lib/features/memory/memory-extraction-pipeline');
			const result = await runMemoryExtractionPipeline('response', 'story-1', 'line-1', 'msg-1');

			expect(mockMemoryInstance.add).toHaveBeenCalledTimes(3);
			expect(mockMemoryInstance.addLocation).toHaveBeenCalledTimes(3);
			expect(result.charactersProcessed).toBe(2);
			expect(result.memoriesAdded).toBe(4);
			expect(result.locationsAdded).toBe(3);
		});

		it('retries per-location on failure', async () => {
			mockParseMemoryExtract.mockReturnValue({
				elena: {
					locations: {
						tavern: ['Memory 1'],
						forest: ['Memory 2'],
					},
				},
			});

			// tavern fails once then succeeds, forest succeeds immediately
			mockMemoryInstance.add
				.mockRejectedValueOnce(new Error('Embedding failed'))
				.mockResolvedValueOnce(1) // tavern retry succeeds
				.mockResolvedValueOnce(1); // forest succeeds

			const { runMemoryExtractionPipeline } = await import('$lib/features/memory/memory-extraction-pipeline');
			const result = await runMemoryExtractionPipeline('response', 'story-1', 'line-1', 'msg-1');

			expect(mockMemoryInstance.add).toHaveBeenCalledTimes(3); // 2 for tavern + 1 for forest
			expect(mockSleep).toHaveBeenCalledTimes(1);
			expect(result.errors).toHaveLength(0);
		});

		it('records error and continues when location fails after all retries', async () => {
			const { log } = await import('$lib/logging/logger');
			mockParseMemoryExtract.mockReturnValue({
				elena: {
					locations: {
						tavern: ['Memory 1'],
						forest: ['Memory 2'],
					},
				},
			});

			// tavern succeeds, forest fails all retries
			mockMemoryInstance.add
				.mockResolvedValueOnce(1) // tavern succeeds
				.mockRejectedValue(new Error('Persistent failure'));

			const { runMemoryExtractionPipeline } = await import('$lib/features/memory/memory-extraction-pipeline');
			const result = await runMemoryExtractionPipeline('response', 'story-1', 'line-1', 'msg-1');

			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain('elena');
			expect(result.errors[0]).toContain('forest');
			expect(vi.mocked(log.error)).toHaveBeenCalled();
		});

		it('handles empty extraction result', async () => {
			mockParseMemoryExtract.mockReturnValue({});

			const { runMemoryExtractionPipeline } = await import('$lib/features/memory/memory-extraction-pipeline');
			const result = await runMemoryExtractionPipeline('response', 'story-1', 'line-1', 'msg-1');

			expect(mockMemoryInstance.add).not.toHaveBeenCalled();
			expect(result.charactersProcessed).toBe(0);
			expect(result.memoriesAdded).toBe(0);
		});
	});
});
