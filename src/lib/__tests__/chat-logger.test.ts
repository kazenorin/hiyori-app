import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing
vi.mock('@tauri-apps/plugin-fs', () => ({
	writeTextFile: vi.fn(async () => {}),
	BaseDirectory: { AppData: 0 }
}));

vi.mock('$lib/fs/story-prompts', () => ({
	resolveStoryFolder: vi.fn(async () => 'test-story-folder')
}));

vi.mock('$lib/stores/stories.svelte', () => ({
	getActiveStory: vi.fn(() => ({ id: 'story-1', name: 'Test Story' }))
}));

vi.mock('$lib/stores/settings.svelte', () => ({
	getSettings: vi.fn(() => ({
		logLevel: 'debug',
		provider: 'openai',
		apiType: 'responses',
		baseURL: '',
		model: '',
		apiKey: ''
	}))
}));

vi.mock('$lib/logging/logger', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {})
	}
}));

import { logMainChat, logWorldBuilderChat } from '$lib/logging/chat-logger';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { getSettings } from '$lib/stores/settings.svelte';
import { getActiveStory } from '$lib/stores/stories.svelte';

const mockWriteTextFile = vi.mocked(writeTextFile);
const mockGetSettings = vi.mocked(getSettings);
const mockGetActiveStory = vi.mocked(getActiveStory);

function defaultSettings() {
	return {
		logLevel: 'debug' as const,
		provider: 'openai' as const,
		apiType: 'responses' as const,
		baseURL: '',
		model: '',
		apiKey: ''
	};
}

describe('chat-logger', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetSettings.mockReturnValue(defaultSettings());
		mockGetActiveStory.mockReturnValue({ id: 'story-1', name: 'Test Story' } as any);
	});

	describe('logMainChat', () => {
		it('writes to main-chat.log when logLevel is debug', async () => {
			await logMainChat({
				systemPrompt: 'You are a GM',
				messages: [{ role: 'user', content: 'Hello' }]
			});

			expect(mockWriteTextFile).toHaveBeenCalledWith(
				expect.stringContaining('main-chat.log'),
				expect.any(String),
				expect.objectContaining({ append: true })
			);
		});

		it('includes system prompt in log content', async () => {
			await logMainChat({
				systemPrompt: 'You are a GM',
				messages: []
			});

			const loggedContent = mockWriteTextFile.mock.calls[0][1] as string;
			expect(loggedContent).toContain('You are a GM');
			expect(loggedContent).toContain('SYSTEM PROMPT');
		});

		it('includes messages in log content', async () => {
			await logMainChat({
				systemPrompt: 'prompt',
				messages: [
					{ role: 'user', content: 'Hello' },
					{ role: 'assistant', content: 'Hi there' }
				]
			});

			const loggedContent = mockWriteTextFile.mock.calls[0][1] as string;
			expect(loggedContent).toContain('[USER]');
			expect(loggedContent).toContain('Hello');
			expect(loggedContent).toContain('[ASSISTANT]');
			expect(loggedContent).toContain('Hi there');
		});

		it('formats timestamp in entry', async () => {
			await logMainChat({
				systemPrompt: 'prompt',
				messages: []
			});

			const loggedContent = mockWriteTextFile.mock.calls[0][1] as string;
			expect(loggedContent).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\]/);
		});

		it('skips writing when logLevel is not debug', async () => {
			mockGetSettings.mockReturnValue({ ...defaultSettings(), logLevel: 'info' });

			await logMainChat({
				systemPrompt: 'prompt',
				messages: []
			});

			expect(mockWriteTextFile).not.toHaveBeenCalled();
		});

		it('skips writing when no active story', async () => {
			mockGetActiveStory.mockReturnValue(null);

			await logMainChat({
				systemPrompt: 'prompt',
				messages: []
			});

			expect(mockWriteTextFile).not.toHaveBeenCalled();
		});
	});

	describe('logWorldBuilderChat', () => {
		it('writes to world-builder.log when logLevel is debug', async () => {
			await logWorldBuilderChat({
				systemPrompt: 'You are a world builder',
				messages: [{ role: 'user', content: 'Create a fantasy world' }]
			});

			expect(mockWriteTextFile).toHaveBeenCalledWith(
				expect.stringContaining('world-builder.log'),
				expect.any(String),
				expect.objectContaining({ append: true })
			);
		});

		it('includes system prompt and messages', async () => {
			await logWorldBuilderChat({
				systemPrompt: 'world-builder prompt',
				messages: [{ role: 'user', content: 'I want dragons' }]
			});

			const loggedContent = mockWriteTextFile.mock.calls[0][1] as string;
			expect(loggedContent).toContain('world-builder prompt');
			expect(loggedContent).toContain('I want dragons');
		});

		it('skips writing when logLevel is not debug', async () => {
			mockGetSettings.mockReturnValue({ ...defaultSettings(), logLevel: 'warn' });

			await logWorldBuilderChat({
				systemPrompt: 'prompt',
				messages: []
			});

			expect(mockWriteTextFile).not.toHaveBeenCalled();
		});
	});
});
