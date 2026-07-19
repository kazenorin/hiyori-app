import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryFileSystem } from '$lib/fs/file-system-in-memory';
import { setFileSystem, fs } from '$lib/fs/file-system';

const { mockResolveTemplateForUpdate, mockStreamText, mockGetMainProviderConfig, mockCreateModel } = vi.hoisted(() => ({
	mockResolveTemplateForUpdate: vi.fn(),
	mockStreamText: vi.fn(),
	mockGetMainProviderConfig: vi.fn(),
	mockCreateModel: vi.fn(),
}));

vi.mock('$lib/logging/logger', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {}),
	},
	fileLog: vi.fn(async () => {}),
}));

vi.mock('$lib/localization', () => ({
	ls: (key: string) => key,
}));

vi.mock('$lib/stores/settings.svelte', () => ({
	getMainProviderConfig: mockGetMainProviderConfig,
}));

vi.mock('$lib/ai/provider', () => ({
	createModel: mockCreateModel,
}));

vi.mock('ai', () => ({
	streamText: mockStreamText,
}));

vi.mock('$lib/definitions/feature-prompts', () => ({
	worldFromActSystemPrompt: () => 'SYSTEM_PROMPT',
	worldFromActPrompt: () => 'EXTRACTION_PROMPT',
}));

vi.mock('$lib/definitions/common-headers', () => ({
	worldContentHeader: () => 'World Content',
	actSummaryHeader: () => 'Act Summary',
	interviewTranscriptHeader: () => 'Interview Transcript',
}));

vi.mock('../template-resolution', () => ({
	resolveTemplateForUpdate: mockResolveTemplateForUpdate,
}));

import { updateWorldCard } from '../world-updater';

function makeFullStream(parts: Array<{ type: string; text: string }>) {
	return {
		fullStream: (async function* () {
			for (const part of parts) yield part;
		})(),
	};
}

const BASE_PARAMS = {
	folderName: 'story-folder',
	currentWorldContent: 'old content',
	actSummary: 'act summary',
	interviewTranscript: [],
};

describe('updateWorldCard — backup restoration', () => {
	let memfs: InMemoryFileSystem;

	beforeEach(() => {
		vi.clearAllMocks();
		memfs = new InMemoryFileSystem();
		memfs.clear();
		setFileSystem(memfs);

		mockGetMainProviderConfig.mockReturnValue({ id: 'p1', model: 'test-model' });
		mockCreateModel.mockResolvedValue({});
		mockResolveTemplateForUpdate.mockResolvedValue('TEMPLATE');
		mockStreamText.mockReturnValue(makeFullStream([{ type: 'text-delta', text: 'new content' }]));
	});

	it('writes new content on success and retains the backup file', async () => {
		await fs.writeTextFile('story-folder/world.md', 'old content');

		const result = await updateWorldCard(BASE_PARAMS);

		expect(result).toBe('new content');
		expect(await fs.readTextFile('story-folder/world.md')).toBe('new content');
		const entries = await fs.readDir('story-folder');
		const names = entries.map((e) => e.name);
		expect(names).toContain('world.md');
		// One backup file matching world-<timestamp>.md should remain.
		expect(names.filter((n) => /^world-\d{14}\.md$/.test(n))).toHaveLength(1);
	});

	it('restores world.md from backup when resolveTemplateForUpdate throws', async () => {
		await fs.writeTextFile('story-folder/world.md', 'original content');
		mockResolveTemplateForUpdate.mockRejectedValue(new Error('template unavailable'));

		await expect(updateWorldCard(BASE_PARAMS)).rejects.toThrow('template unavailable');

		expect(await fs.readTextFile('story-folder/world.md')).toBe('original content');
		const entries = await fs.readDir('story-folder');
		expect(entries.map((e) => e.name).sort()).toEqual(['world.md']);
	});

	it('restores world.md from backup when streamText throws synchronously', async () => {
		await fs.writeTextFile('story-folder/world.md', 'original content');
		mockStreamText.mockImplementation(() => {
			throw new Error('streaming blew up');
		});

		await expect(updateWorldCard(BASE_PARAMS)).rejects.toThrow('streaming blew up');

		expect(await fs.readTextFile('story-folder/world.md')).toBe('original content');
	});

	it('restores world.md from backup when fullStream iteration throws mid-stream', async () => {
		await fs.writeTextFile('story-folder/world.md', 'original content');
		mockStreamText.mockReturnValue({
			fullStream: (async function* () {
				yield { type: 'text-delta', text: 'partial' };
				throw new Error('mid-stream error');
			})(),
		});

		await expect(updateWorldCard(BASE_PARAMS)).rejects.toThrow('mid-stream error');

		expect(await fs.readTextFile('story-folder/world.md')).toBe('original content');
	});

	it('does not attempt a restore when world.md did not exist pre-call', async () => {
		expect(await fs.exists('story-folder/world.md')).toBe(false);
		mockResolveTemplateForUpdate.mockRejectedValue(new Error('template unavailable'));

		await expect(updateWorldCard(BASE_PARAMS)).rejects.toThrow('template unavailable');

		expect(await fs.exists('story-folder/world.md')).toBe(false);
		// story-folder directory was never created because we never wrote a backup.
		expect(await fs.exists('story-folder')).toBe(false);
	});

	it('re-throws the original error, not a restore-related error', async () => {
		await fs.writeTextFile('story-folder/world.md', 'original content');
		const originalError = new Error('original failure');
		mockResolveTemplateForUpdate.mockRejectedValue(originalError);

		await expect(updateWorldCard(BASE_PARAMS)).rejects.toBe(originalError);
	});
});
