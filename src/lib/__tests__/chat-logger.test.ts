import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFs } = vi.hoisted(() => {
	const mockFs = {
		readTextFile: vi.fn(async () => ''),
		readTextFileIfExists: vi.fn(async () => undefined),
		writeTextFile: vi.fn(async () => {}),
		writeTextFileEnsuringDir: vi.fn(async () => {}),
		mkdir: vi.fn(async () => {}),
		exists: vi.fn(async () => false),
		remove: vi.fn(async () => {}),
		rename: vi.fn(async () => {}),
		copyFile: vi.fn(async () => {}),
		readDir: vi.fn(async () => []),
		ensureDir: vi.fn(async () => {}),
	};
	return { mockFs };
});

// Mock dependencies before importing
vi.mock('$lib/fs/file-system', () => ({
	fs: mockFs,
}));

vi.mock('$lib/fs/story-folders', () => ({
	resolveStoryFolder: vi.fn(async () => 'test-story-folder'),
}));

vi.mock('$lib/stores/stories.svelte', () => ({
	getActiveStory: vi.fn(() => ({ id: 'story-1', name: 'Test Story' })),
}));

vi.mock('$lib/logging/logger', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {}),
	},
	fileLog: vi.fn(async () => {}),
	getLogLevel: vi.fn(() => 'debug'),
}));

import { logMainChat, logWorldBuilderChat } from '$lib/logging/chat-logger';
import { getLogLevel } from '$lib/logging/logger';
import { getActiveStory } from '$lib/stores/stories.svelte';
import type { Story } from '$lib/db/stories';
import type { UIMessage } from '$lib/ai/chat/types';

const mockWriteTextFile = vi.mocked(mockFs.writeTextFile);
const mockGetLogLevel = vi.mocked(getLogLevel);
const mockGetActiveStory = vi.mocked(getActiveStory);

function firstLoggedContent(): string {
	return (mockWriteTextFile.mock.calls[0] as unknown as [string, string])[1];
}

/** Extract the pretty-printed JSON array from a formatted log entry. */
function parseLoggedEntries(raw: string): Record<string, unknown>[] {
	return JSON.parse(raw.slice(raw.indexOf('[\n'), raw.lastIndexOf(']') + 1));
}

describe('chat-logger', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetLogLevel.mockReturnValue('debug');
		mockGetActiveStory.mockReturnValue({ id: 'story-1', name: 'Test Story' } as Story);
	});

	describe('logMainChat', () => {
		const userMessage = {
			id: 'user-1',
			role: 'user',
			content: 'Hello',
			sceneNumber: 1,
		} satisfies UIMessage;

		const assistantMessage = {
			id: 'assistant-1',
			role: 'assistant',
			content: 'Rendered template output',
			sceneNumber: 1,
			reasoning: 'chain of thought',
			variables: {
				sceneTitle: 'Dawn',
				background: 'forest',
				narrativeBody: 'The story prose.',
				turnOfEvents: 'Morning arrives',
				cg: 'cg-1',
				gameData: null,
			},
		} satisfies UIMessage;

		it('writes to main-chat.log when logLevel is debug', async () => {
			await logMainChat([userMessage]);

			expect(mockWriteTextFile).toHaveBeenCalledWith(
				expect.stringContaining('main-chat.log'),
				expect.any(String),
				expect.objectContaining({ append: true })
			);
		});

		it('logs selected fields as pretty-printed JSON in declaration order', async () => {
			await logMainChat([userMessage, assistantMessage]);

			const entries = parseLoggedEntries(firstLoggedContent());
			expect(entries).toHaveLength(2);
			expect(Object.keys(entries[1])).toEqual([
				'role',
				'sceneNumber',
				'sceneTitle',
				'content',
				'background',
				'cg',
				'turnOfEvents',
				'reasoning',
			]);
			expect(entries[1].content).toBe('The story prose.');
			expect(firstLoggedContent()).toContain('\n  {\n');
		});

		it('falls back to message content when narrativeBody is missing', async () => {
			await logMainChat([userMessage]);

			const entries = parseLoggedEntries(firstLoggedContent());
			expect(entries[0].content).toBe('Hello');
			expect(Object.keys(entries[0])).toEqual(['role', 'sceneNumber', 'content']);
		});

		it('formats timestamp in entry', async () => {
			await logMainChat([]);

			expect(firstLoggedContent()).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\]/);
		});

		it('skips writing when logLevel is not debug', async () => {
			mockGetLogLevel.mockReturnValue('info');

			await logMainChat([userMessage]);

			expect(mockWriteTextFile).not.toHaveBeenCalled();
		});

		it('skips writing when no active story', async () => {
			mockGetActiveStory.mockReturnValue(null);

			await logMainChat([userMessage]);

			expect(mockWriteTextFile).not.toHaveBeenCalled();
		});
	});

	describe('logWorldBuilderChat', () => {
		it('writes to temp log when logFilename provided and logLevel is debug', async () => {
			await logWorldBuilderChat({
				systemPrompt: 'You are a world builder',
				messages: [{ role: 'user', content: 'Create a fantasy world' }],
				logFilename: 'worldbuilding-20260411093000.log',
			});

			expect(mockFs.writeTextFileEnsuringDir).toHaveBeenCalledWith(
				expect.stringContaining('logs/worldbuilding-20260411093000.log'),
				expect.any(String),
				expect.objectContaining({ append: true })
			);
		});

		it('includes system prompt and messages in temp log', async () => {
			await logWorldBuilderChat({
				systemPrompt: 'world-builder prompt',
				messages: [{ role: 'user', content: 'I want dragons' }],
				logFilename: 'worldbuilding-test.log',
			});

			const loggedContent = (mockFs.writeTextFileEnsuringDir.mock.calls[0] as unknown as [string, string])[1];
			expect(loggedContent).toContain('world-builder prompt');
			expect(loggedContent).toContain('I want dragons');
		});

		it('skips writing when logLevel is not debug', async () => {
			mockGetLogLevel.mockReturnValue('warn');

			await logWorldBuilderChat({
				systemPrompt: 'prompt',
				messages: [],
			});

			expect(mockWriteTextFile).not.toHaveBeenCalled();
		});
	});
});
