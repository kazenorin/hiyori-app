import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prompts
vi.mock('$lib/fs/prompts', () => ({
	loadReviewerSystemPrompt: vi.fn(async () => 'Review system prompt with {knownCharacterNameList}'),
	loadRevisionModeFragment: vi.fn(async () => '### Revision Mode\nFix all violations.'),
	loadRevisionRequestExtractionPrompt: vi.fn(async () => '### Revision Request\n{reviewer_json_report}\n### Instructions'),
	loadSystemPrompt: vi.fn(async () => 'Main system prompt'),
}));

// Mock memory
vi.mock('$lib/memory/memory', () => ({
	knownCharacterNameList: vi.fn(async () => ['Elena Thornwood', 'Marcus Vale']),
}));

// Mock settings
const mockReviewerConfig = {
	id: 'reviewer-id',
	name: 'Reviewer',
	provider: 'openai' as const,
	apiType: 'responses' as const,
	baseURL: 'https://api.openai.com/v1',
	model: 'gpt-4o',
	apiKey: 'sk-reviewer',
};

let mockReviewerProviderConfig: typeof mockReviewerConfig | undefined = mockReviewerConfig;

vi.mock('$lib/stores/settings.svelte', () => ({
	getReviewerProviderConfig: vi.fn(() => mockReviewerProviderConfig),
	getMainProviderConfig: vi.fn(() => mockReviewerConfig),
}));

// Mock logger
vi.mock('$lib/logging/logger', () => ({
	log: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

// Mock chat-stream
const mockStreamAccumulator = (content: string) => ({
	callbacks: {} as any,
	state: { content, reasoning: null, gameData: null },
	resultMetadata: Promise.resolve({
		finishReason: 'stop',
		usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
		durationMs: 1000,
	}),
});

let mockStreamWithRetryResult: any;

vi.mock('$lib/ai/chat-stream', () => ({
	streamWithRetry: vi.fn(async () => mockStreamWithRetryResult),
}));

import { streamReview, type ReviewLoopResult } from '$lib/reviewer/review-loop';
import { loadReviewerSystemPrompt, loadRevisionModeFragment, loadRevisionRequestExtractionPrompt, loadSystemPrompt } from '$lib/fs/prompts';
import { knownCharacterNameList } from '$lib/memory/memory';
import { streamWithRetry } from '$lib/ai/chat-stream';

const baseTranscript = [
	{ role: 'user' as const, content: 'Player message' },
	{ role: 'assistant' as const, content: 'GM response' },
	{ role: 'user' as const, content: 'Player reply' },
	{ role: 'assistant' as const, content: 'GM output to review' },
];

describe('review-loop', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockReviewerProviderConfig = mockReviewerConfig;
	});

	describe('streamReview', () => {
		it('returns null when review approves', async () => {
			mockStreamWithRetryResult = mockStreamAccumulator(
				JSON.stringify({ approved: true, violations: [] })
			);

			const result = await streamReview(baseTranscript);
			expect(result).toBeNull();
		});

		it('returns null when JSON parse fails', async () => {
			mockStreamWithRetryResult = mockStreamAccumulator('Not valid JSON at all');

			const result = await streamReview(baseTranscript);
			expect(result).toBeNull();
		});

		it('returns null when JSON is inside markdown fences', async () => {
			const json = JSON.stringify({ approved: true, violations: [] });
			mockStreamWithRetryResult = mockStreamAccumulator('```json\n' + json + '\n```');

			const result = await streamReview(baseTranscript);
			expect(result).toBeNull();
		});

		it('runs revision when violations found', async () => {
			const violations = [
				{
					rule: 'Rule 1 — Name Uniqueness',
					severity: 'critical',
					description: 'Duplicate character introduction.',
					offending_excerpt: 'Elena walked in.',
					suggested_fix: null,
				},
			];

			let callIndex = 0;
			vi.mocked(streamWithRetry).mockImplementation(async () => {
				callIndex++;
				if (callIndex === 1) {
					// Review pass
					return mockStreamAccumulator(
						JSON.stringify({ approved: false, violations })
					);
				}
				// Revision pass
				return mockStreamAccumulator('Revised GM output with fixes applied.');
			});

			const result = await streamReview(baseTranscript) as ReviewLoopResult;

			expect(result).not.toBeNull();
			expect(result.review.approved).toBe(false);
			expect(result.review.violations).toHaveLength(1);
			expect(result.revisedContent).toBe('Revised GM output with fixes applied.');

			// Two calls: review + revision
			expect(streamWithRetry).toHaveBeenCalledTimes(2);
		});

		it('builds review history with forced user roles', async () => {
			mockStreamWithRetryResult = mockStreamAccumulator(
				JSON.stringify({ approved: true, violations: [] })
			);

			await streamReview(baseTranscript);

			const [systemPromptArg, historyArg] = vi.mocked(streamWithRetry).mock.calls[0];

			// System prompt should have knownCharacterNameList replaced
			expect(systemPromptArg).toContain('["Elena Thornwood","Marcus Vale"]');
			expect(systemPromptArg).not.toContain('{knownCharacterNameList}');

			// History: first message is "Below is the transcript:"
			expect(historyArg[0]).toEqual({ role: 'user', content: 'Below is the transcript:' });

			// User messages get "Player responded: " prefix
			expect(historyArg[1]).toEqual({ role: 'user', content: 'Player responded: Player message' });

			// Assistant messages keep their content
			expect(historyArg[2]).toEqual({ role: 'user', content: 'GM response' });

			// Last message wraps GM output
			const lastMsg = historyArg[historyArg.length - 1];
			expect(lastMsg.role).toBe('user');
			expect(lastMsg.content).toContain("GM's Output to review");
			expect(lastMsg.content).toContain('GM output to review');
		});

		it('falls back to main provider when reviewer config is unset', async () => {
			mockReviewerProviderConfig = undefined;
			mockStreamWithRetryResult = mockStreamAccumulator(
				JSON.stringify({ approved: true, violations: [] })
			);

			await streamReview(baseTranscript);

			// Should still succeed using main provider fallback
			expect(streamWithRetry).toHaveBeenCalledTimes(1);
		});

		it('replaces {reviewer_json_report} in revision request', async () => {
			const violations = [
				{
					rule: 'Rule 3 — Style',
					severity: 'warning' as const,
					description: 'Telling instead of showing.',
					offending_excerpt: 'She felt sad.',
					suggested_fix: 'Tears welled in her eyes.',
				},
			];

			let callIndex = 0;
			vi.mocked(streamWithRetry).mockImplementation(async () => {
				callIndex++;
				if (callIndex === 1) {
					return mockStreamAccumulator(
						JSON.stringify({ approved: false, violations })
					);
				}
				return mockStreamAccumulator('Corrected output.');
			});

			await streamReview(baseTranscript);

			// Second call is the revision — check the last history message
			const revisionCall = vi.mocked(streamWithRetry).mock.calls[1];
			const revisionHistory = revisionCall[1];
			const revisionUserMsg = revisionHistory[revisionHistory.length - 1];

			expect(revisionUserMsg.content).toContain('Rule 3');
			expect(revisionUserMsg.content).not.toContain('{reviewer_json_report}');
		});
	});
});
