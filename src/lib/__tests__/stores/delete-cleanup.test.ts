import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDatabase } from '../helpers/test-database';
import { runMigrations } from '$lib/db/migrations';
import { InMemoryFileSystem } from '$lib/fs/file-system-in-memory';
import * as dbStories from '$lib/db/stories';
import * as dbStoryFolders from '$lib/db/story-folders';
import * as dbActs from '$lib/db/acts';
import * as dbActLines from '$lib/db/act-lines';
import type { FileSystem } from '$lib/fs/file-system';

let testDb: ReturnType<typeof createTestDatabase>;
let fs: FileSystem;

vi.mock('$lib/db/database', () => ({
	initDatabase: vi.fn(async () => testDb),
	getDatabase: vi.fn(() => testDb),
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

describe('stories store filesystem cleanup', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
		vi.resetModules();
		const fileSystemModule = await import('$lib/fs/file-system');
		fs = fileSystemModule.fs;
		fileSystemModule.setFileSystem(new InMemoryFileSystem());
	});

	afterEach(() => {
		testDb.close();
	});

	describe('deleteStory', () => {
		it('removes the story folder when removeFolder is true', async () => {
			const { loadStories, deleteStory } = await import('$lib/stores/stories.svelte');

			const story = await dbStories.createStory('story-1', 'Test Story', 'en');
			await dbStoryFolders.setStoryFolder(story.id, 'test-story');

			await fs.writeTextFile('test-story/world.md', '# World');
			await fs.mkdir('test-story/act-1/main-line');
			await fs.writeTextFile('test-story/act-1/main-line/act-plot.md', 'plot');

			await loadStories();
			await deleteStory(story.id, true);

			expect(await fs.exists('test-story')).toBe(false);
		});

		it('keeps the story folder when removeFolder is false', async () => {
			const { loadStories, deleteStory } = await import('$lib/stores/stories.svelte');

			const story = await dbStories.createStory('story-2', 'Test Story 2', 'en');
			await dbStoryFolders.setStoryFolder(story.id, 'test-story-2');

			await fs.writeTextFile('test-story-2/world.md', '# World');
			await fs.mkdir('test-story-2/act-1/main-line');
			await fs.writeTextFile('test-story-2/act-1/main-line/act-plot.md', 'plot');

			await loadStories();
			await deleteStory(story.id, false);

			expect(await fs.exists('test-story-2')).toBe(true);
			expect(await fs.exists('test-story-2/act-1/main-line/act-plot.md')).toBe(true);
		});
	});

	describe('deleteAct', () => {
		it('removes the act folder when removeFolder is true', async () => {
			const { loadStories, selectStory, deleteAct } = await import('$lib/stores/stories.svelte');

			const story = await dbStories.createStory('story-3', 'Test Story 3', 'en');
			await dbStoryFolders.setStoryFolder(story.id, 'test-story-3');
			await dbActs.createAct('act-1', story.id, 'Act 1', 1);

			await fs.writeTextFile('test-story-3/world.md', '# World');

			await loadStories();
			await selectStory(story.id);

			await fs.mkdir('test-story-3/act-1/main-line');
			await fs.writeTextFile('test-story-3/act-1/main-line/act-plot.md', 'plot');
			await fs.writeTextFile('test-story-3/act-1/act-card.md', 'card');

			expect(await fs.exists('test-story-3/act-1')).toBe(true);

			await deleteAct('act-1', true);

			expect(await fs.exists('test-story-3/act-1')).toBe(false);
		});

		it('keeps the act folder when removeFolder is false', async () => {
			const { loadStories, selectStory, deleteAct } = await import('$lib/stores/stories.svelte');

			const story = await dbStories.createStory('story-4', 'Test Story 4', 'en');
			await dbStoryFolders.setStoryFolder(story.id, 'test-story-4');
			await dbActs.createAct('act-2', story.id, 'Act 2', 1);

			await fs.writeTextFile('test-story-4/world.md', '# World');

			await loadStories();
			await selectStory(story.id);

			await fs.mkdir('test-story-4/act-1/main-line');
			await fs.writeTextFile('test-story-4/act-1/main-line/act-plot.md', 'plot');

			expect(await fs.exists('test-story-4/act-1')).toBe(true);

			await deleteAct('act-2', false);

			expect(await fs.exists('test-story-4/act-1')).toBe(true);
			expect(await fs.exists('test-story-4/act-1/main-line/act-plot.md')).toBe(true);
		});
	});

	describe('deleteActLine', () => {
		it('removes the line folder when removeFolder is true', async () => {
			const { loadStories, selectStory, selectAct, deleteActLine } = await import('$lib/stores/stories.svelte');

			const story = await dbStories.createStory('story-5', 'Test Story 5', 'en');
			await dbStoryFolders.setStoryFolder(story.id, 'test-story-5');
			const act = await dbActs.createAct('act-3', story.id, 'Act 3', 1);
			const line = await dbActLines.createActLine('line-1', act.id, 'Main Line', true);

			await fs.writeTextFile('test-story-5/world.md', '# World');

			await loadStories();
			await selectStory(story.id);
			await selectAct(act.id);

			await fs.mkdir('test-story-5/act-1/main-line');
			await fs.writeTextFile('test-story-5/act-1/main-line/act-plot.md', 'plot');
			await fs.writeTextFile('test-story-5/act-1/main-line/character-card.md', 'card');

			expect(await fs.exists('test-story-5/act-1/main-line')).toBe(true);

			await deleteActLine(line.id, true);

			expect(await fs.exists('test-story-5/act-1/main-line')).toBe(false);
		});

		it('keeps the line folder when removeFolder is false', async () => {
			const { loadStories, selectStory, selectAct, deleteActLine } = await import('$lib/stores/stories.svelte');

			const story = await dbStories.createStory('story-6', 'Test Story 6', 'en');
			await dbStoryFolders.setStoryFolder(story.id, 'test-story-6');
			const act = await dbActs.createAct('act-4', story.id, 'Act 4', 1);
			const line = await dbActLines.createActLine('line-2', act.id, 'Main Line', true);

			await fs.writeTextFile('test-story-6/world.md', '# World');

			await loadStories();
			await selectStory(story.id);
			await selectAct(act.id);

			await fs.mkdir('test-story-6/act-1/main-line');
			await fs.writeTextFile('test-story-6/act-1/main-line/act-plot.md', 'plot');

			expect(await fs.exists('test-story-6/act-1/main-line')).toBe(true);

			await deleteActLine(line.id, false);

			expect(await fs.exists('test-story-6/act-1/main-line')).toBe(true);
			expect(await fs.exists('test-story-6/act-1/main-line/act-plot.md')).toBe(true);
		});
	});
});
