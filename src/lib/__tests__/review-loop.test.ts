import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prompts
vi.mock('$lib/fs/prompts', () => ({
	loadSystemPrompt: vi.fn(async () => 'Main system prompt with trigger-editor-mode-fragment'),
	loadEditorModeExtractionPrompt: vi.fn(async () => '# Editor Mode\n\nReview the output.\n\n{knownCharacterNameList}\n\n<review_scratchpad>...'),
	loadNarrationContent: vi.fn(async () => 'Narration extraction prompt\n\nNarration template'),
}));

vi.mock('$lib/stores/stories.svelte', () => ({
	getActiveSystemPromptOrDefault: vi.fn(async () => 'Main system prompt with trigger-editor-mode-fragment'),
	getActiveNarrationTemplateOrDefault: vi.fn(async () => 'Narration extraction prompt\n\nNarration template'),
}));

// Mock settings - import settings for loadSystemPrompt behavior
vi.mock('$lib/stores/settings.svelte', () => ({
	settings: { reviewerEnabled: true },
	getReviewerProviderConfig: vi.fn(() => mockReviewerProviderConfig),
	getMainProviderConfig: vi.fn(() => mockReviewerConfig),
}));

// Mock memory
vi.mock('$lib/memory/memory', () => ({
	knownCharacterNameList: vi.fn(async () => ['Elena Thornwood', 'Marcus Vale']),
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
const mockStreamAccumulator = (content: string) => {
	const scratchpad = extractTagContent(content, 'review_scratchpad');
	const revisedNarrative = extractTagContent(content, 'revised_narrative');
	return {
		callbacks: {} as any,
		state: { content, reasoning: null, gameData: null, reviewScratchpad: scratchpad, revisedNarrative, revisedGameData: null },
		resultMetadata: Promise.resolve({
			finishReason: 'stop',
			usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
			durationMs: 1000,
		}),
	};
};

function extractTagContent(text: string, tag: string): string | null {
	const openTag = `<${tag}>`;
	const closeTag = `</${tag}>`;
	const start = text.indexOf(openTag);
	if (start === -1) return null;
	const end = text.indexOf(closeTag, start);
	if (end === -1) return null;
	return text.slice(start + openTag.length, end).trim();
}

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
let mockStreamWithRetryResult: any;

vi.mock('$lib/ai/chat-stream', () => ({
	streamWithRetry: vi.fn(async () => mockStreamWithRetryResult),
}));

import { streamReview, type ReviewLoopResult } from '$lib/reviewer/review-loop';
import { loadSystemPrompt, loadEditorModeExtractionPrompt } from '$lib/fs/prompts';
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
		it('returns null when no revised_narrative tag found', async () => {
			mockStreamWithRetryResult = mockStreamAccumulator('Just some text without the right tags');

			const result = await streamReview(baseTranscript);
			expect(result).toBeNull();
		});

		it('extracts revised_narrative and review_scratchpad', async () => {
			const response = `<review_scratchpad>
- Rule 1 Analysis: No issues found.
- Rule 2 Analysis: Character "Bob" contradicts established traits.
- Planned Fixes: Change Bob's dialogue to match.
</review_scratchpad>

<revised_narrative>
The corrected narrative output goes here.
</revised_narrative>`;

			mockStreamWithRetryResult = mockStreamAccumulator(response);

			const result = await streamReview(baseTranscript) as ReviewLoopResult;

			expect(result).not.toBeNull();
			expect(result.scratchpad).toContain('Rule 1 Analysis');
			expect(result.scratchpad).toContain('Planned Fixes');
			expect(result.revisedContent).toBe('The corrected narrative output goes here.');
		});

		it('returns empty scratchpad when review_scratchpad tag is missing', async () => {
			mockStreamWithRetryResult = mockStreamAccumulator(
				'<revised_narrative>\nFixed output.\n</revised_narrative>'
			);

			const result = await streamReview(baseTranscript) as ReviewLoopResult;

			expect(result.scratchpad).toBe('');
			expect(result.revisedContent).toBe('Fixed output.');
		});

		it('sends transcript as-is with editor prompt appended as user message', async () => {
			mockStreamWithRetryResult = mockStreamAccumulator(
				'<revised_narrative>\nFixed.\n</revised_narrative>'
			);

			await streamReview(baseTranscript);

			expect(streamWithRetry).toHaveBeenCalledTimes(1);

			const [systemPromptArg, historyArg] = vi.mocked(streamWithRetry).mock.calls[0];

			// System prompt from loadSystemPrompt
			expect(systemPromptArg).toBe('Main system prompt with trigger-editor-mode-fragment');

			// History = transcript + editor prompt as last user message
			expect(historyArg.length).toBe(baseTranscript.length + 1);

			// First messages match the transcript exactly
			for (let i = 0; i < baseTranscript.length; i++) {
				expect(historyArg[i]).toEqual(baseTranscript[i]);
			}

			// Last message is the editor prompt
			const lastMsg = historyArg[historyArg.length - 1];
			expect(lastMsg.role).toBe('user');
			expect(lastMsg.content).toContain('# Editor Mode');
			expect(lastMsg.content).toContain('["Elena Thornwood","Marcus Vale"]');
			expect(lastMsg.content).not.toContain('{knownCharacterNameList}');
		});

		it('replaces {knownCharacterNameList} with character names in editor prompt', async () => {
			mockStreamWithRetryResult = mockStreamAccumulator(
				'<revised_narrative>\nDone.\n</revised_narrative>'
			);

			await streamReview(baseTranscript);

			const lastMsg = vi.mocked(streamWithRetry).mock.calls[0][1].at(-1)!;
			expect(lastMsg.content).toContain('Elena Thornwood');
			expect(lastMsg.content).toContain('Marcus Vale');
			expect(lastMsg.content).not.toContain('{knownCharacterNameList}');
		});

		it('falls back to main provider when reviewer config is unset', async () => {
			mockReviewerProviderConfig = undefined;
			mockStreamWithRetryResult = mockStreamAccumulator(
				'<revised_narrative>\nFixed.\n</revised_narrative>'
			);

			const result = await streamReview(baseTranscript) as ReviewLoopResult;
			expect(result).not.toBeNull();
			expect(streamWithRetry).toHaveBeenCalledTimes(1);
		});
	});
});
