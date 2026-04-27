import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NarrativeVariables } from '../ai/parser-chain';

// Mock prompts
vi.mock('$lib/fs/prompts', () => ({
	loadSystemPrompt: vi.fn(async () => 'Main system prompt with trigger-editor-mode-fragment'),
	loadEditorModeExtractionPrompt: vi.fn(
		async () => '# Editor Mode\n\nReview the output.\n\n{knownCharacterNameList}\n\n# Review Scratchpad\n\n...'
	),
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

/**
 * Creates a mock StreamAccumulator with state derived from
 * markdown-header-based output (# Review Scratchpad, # Revised Narrative).
 * This mirrors how the SAX section parser populates StreamState.
 */
const mockStreamAccumulator = (content: string) => {
	const scratchpadMatch = content.match(/^# Review Scratchpad\s*\n([\s\S]*?)(?=\n# Revised Narrative)/m);
	const narrativeMatch = content.match(/^# Revised Narrative\s*\n([\s\S]*?)$/m);

	const vars: NarrativeVariables = {
		scratchpad: scratchpadMatch ? scratchpadMatch[1].trim() : null,
		storyTitle: null,
		actNumber: null,
		sessionNumber: null,
		sceneNumber: null,
		sceneTitle: null,
		background: null,
		narrativeBody: narrativeMatch ? narrativeMatch[1].trim() : null,
		cg: null,
		currentContext: null,
		activePlotThreads: null,
		decisionContext: null,
		gameData: null,
	};

	return {
		callbacks: {} as any,
		state: {
			content,
			reasoning: null,
			variables: vars,
		},
		resultMetadata: Promise.resolve({
			finishReason: 'stop',
			usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
			durationMs: 1000,
		}),
	};
};

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
		it('returns null when no narrative variables with content found', async () => {
			mockStreamWithRetryResult = {
				callbacks: {} as any,
				state: {
					content: 'Just some text without the right sections',
					reasoning: null,
					variables: null,
				},
				resultMetadata: Promise.resolve({
					finishReason: 'stop',
					usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
					durationMs: 0,
				}),
			};

			const result = await streamReview(baseTranscript);
			expect(result).toBeNull();
		});

		it('extracts narrative variables from Review Scratchpad and Revised Narrative sections', async () => {
			const response = `# Review Scratchpad
- Rule 1 Analysis: No issues found.
- Rule 2 Analysis: Character "Bob" contradicts established traits.
- Planned Fixes: Change Bob's dialogue to match.

# Revised Narrative
The corrected narrative output goes here.`;

			mockStreamWithRetryResult = mockStreamAccumulator(response);

			const result = (await streamReview(baseTranscript)) as ReviewLoopResult;

			expect(result).not.toBeNull();
			expect(result.variables.scratchpad).toContain('Rule 1 Analysis');
			expect(result.variables.scratchpad).toContain('Planned Fixes');
			expect(result.variables.narrativeBody).toBe('The corrected narrative output goes here.');
		});

		it('returns null scratchpad when Review Scratchpad section is missing', async () => {
			mockStreamWithRetryResult = mockStreamAccumulator(`# Revised Narrative\nFixed output.`);

			const result = (await streamReview(baseTranscript)) as ReviewLoopResult;

			expect(result.variables.scratchpad).toBeNull();
			expect(result.variables.narrativeBody).toBe('Fixed output.');
		});

		it('sends transcript as-is with editor prompt appended as user message', async () => {
			mockStreamWithRetryResult = mockStreamAccumulator('# Revised Narrative\nFixed.');

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
			mockStreamWithRetryResult = mockStreamAccumulator('# Revised Narrative\nDone.');

			await streamReview(baseTranscript);

			const lastMsg = vi.mocked(streamWithRetry).mock.calls[0][1].at(-1)!;
			expect(lastMsg.content).toContain('Elena Thornwood');
			expect(lastMsg.content).toContain('Marcus Vale');
			expect(lastMsg.content).not.toContain('{knownCharacterNameList}');
		});

		it('falls back to main provider when reviewer config is unset', async () => {
			mockReviewerProviderConfig = undefined;
			mockStreamWithRetryResult = mockStreamAccumulator('# Revised Narrative\nFixed.');

			const result = (await streamReview(baseTranscript)) as ReviewLoopResult;
			expect(result).not.toBeNull();
			expect(streamWithRetry).toHaveBeenCalledTimes(1);
		});
	});
});
