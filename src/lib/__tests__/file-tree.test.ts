import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryFileSystem } from '$lib/fs/file-system-in-memory';
import { setFileSystem } from '$lib/fs/file-system';
import * as dbStoryFolders from '$lib/db/story-folders';
import {
	readDirectoryNodes,
	classifyManagedConfig,
	getFolderType,
	copyStoryOverrideToConfig,
	copyStoryOverrideToStory,
	isCriticalSystemFile,
	CRITICAL_SYSTEM_FILENAMES,
} from '$lib/fs/file-tree';

describe('readDirectoryNodes — managedConfig classification', () => {
	let fs: InMemoryFileSystem;

	beforeEach(() => {
		fs = new InMemoryFileSystem();
		fs.clear();
		setFileSystem(fs);
		vi.restoreAllMocks();
	});

	describe('getFolderType', () => {
		it('returns config for the config directory itself', () => {
			expect(getFolderType('config')).toBe('config');
		});

		it('returns config for files inside config', () => {
			expect(getFolderType('config/en/prompts/test.md')).toBe('config');
		});

		it('returns default for unrelated paths', () => {
			expect(getFolderType('my-story')).toBe('default');
			expect(getFolderType('random/file.md')).toBe('default');
		});
	});

	describe('classifyManagedConfig', () => {
		it('returns null for non-.md files', () => {
			expect(classifyManagedConfig('config/test.json', 'config')).toBeNull();
		});

		it('returns null when folderType is undefined', () => {
			// This was the bug: folderType was always undefined for files
			expect(classifyManagedConfig('config/en/prompt-templates/act/act-card-template.md', undefined)).toBeNull();
		});

		it('classifies known config .md files as managed', () => {
			// This path exists in the bundled manifest
			const result = classifyManagedConfig('config/en/prompt-templates/act/act-card-template.md', 'config');
			expect(result).toBe('managed');
		});

		it('classifies story files with manifest match as story-override', () => {
			const result = classifyManagedConfig('my-story/en/prompt-templates/act/act-card-template.md', 'story');
			expect(result).toBe('story-override');
		});
	});

	describe('readDirectoryNodes', () => {
		it('sets managedConfig on config .md files when manifest has an entry', async () => {
			vi.spyOn(dbStoryFolders, 'getAllFolderNames').mockResolvedValue([]);

			await fs.writeTextFile('config/en/prompt-templates/act/act-card-template.md', 'test');
			await fs.writeTextFile('config/other.txt', 'text');

			const nodes = await readDirectoryNodes('');
			const configDir = nodes.find((n) => n.name === 'config');
			expect(configDir).toBeDefined();
			expect(configDir!.isDirectory).toBe(true);
			expect(configDir!.folderType).toBe('config');
			expect(configDir!.managedConfig).toBeUndefined();

			const children = await readDirectoryNodes('config');
			const enDir = children.find((n) => n.name === 'en');
			expect(enDir?.folderType).toBe('config');

			const _promptChildren = await readDirectoryNodes('config/en');
			const _templateChildren = await readDirectoryNodes('config/en/prompt-templates');
			const actChildren = await readDirectoryNodes('config/en/prompt-templates/act');
			const mdFile = actChildren.find((n) => n.name === 'act-card-template.md');
			expect(mdFile).toBeDefined();
			expect(mdFile!.isDirectory).toBe(false);
			expect(mdFile!.managedConfig).toBe('managed');

			const txtFile = children.find((n) => n.name === 'other.txt');
			expect(txtFile!.managedConfig).toBeUndefined();
		});

		it('sets managedConfig on story .md files matching manifest entries', async () => {
			vi.spyOn(dbStoryFolders, 'getAllFolderNames').mockResolvedValue(['my-story']);

			await fs.writeTextFile('my-story/en/prompt-templates/act/act-card-template.md', 'override');

			const nodes = await readDirectoryNodes('');
			const storyDir = nodes.find((n) => n.name === 'my-story');
			expect(storyDir!.folderType).toBe('story');

			const actChildren = await readDirectoryNodes('my-story/en/prompt-templates/act');
			const mdFile = actChildren.find((n) => n.name === 'act-card-template.md');
			expect(mdFile).toBeDefined();
			expect(mdFile!.managedConfig).toBe('story-override');
		});

		it('sets folderType on file nodes matching parent directory', async () => {
			vi.spyOn(dbStoryFolders, 'getAllFolderNames').mockResolvedValue([]);

			await fs.writeTextFile('config/test.md', 'test');

			const nodes = await readDirectoryNodes('config');
			const file = nodes.find((n) => n.name === 'test.md');
			expect(file!.isDirectory).toBe(false);
			expect(file!.folderType).toBe('config');
			expect(file!.managedConfig).toBeUndefined();
		});
	});
});

describe('copyStoryOverrideToConfig', () => {
	let fs: InMemoryFileSystem;

	beforeEach(() => {
		fs = new InMemoryFileSystem();
		fs.clear();
		setFileSystem(fs);
		vi.restoreAllMocks();
	});

	it('writes the override content into the corresponding config path, overwriting prior content', async () => {
		const storyPath = 'my-story/en/prompt-templates/act/act-card-template.md';
		const configPath = 'config/en/prompt-templates/act/act-card-template.md';
		await fs.writeTextFileEnsuringDir(configPath, 'old default');
		await fs.writeTextFileEnsuringDir(storyPath, 'override content');

		await copyStoryOverrideToConfig(storyPath);

		expect(await fs.readTextFile(configPath)).toBe('override content');
		expect(await fs.readTextFile(storyPath)).toBe('override content');
	});

	it('creates the destination directory tree when missing', async () => {
		const storyPath = 'my-story/en/prompt-templates/act/act-card-template.md';
		const configPath = 'config/en/prompt-templates/act/act-card-template.md';
		await fs.writeTextFileEnsuringDir(storyPath, 'fresh override');

		expect(await fs.exists(configPath)).toBe(false);

		await copyStoryOverrideToConfig(storyPath);

		expect(await fs.exists(configPath)).toBe(true);
		expect(await fs.readTextFile(configPath)).toBe('fresh override');
	});
});

describe('copyStoryOverrideToStory', () => {
	let fs: InMemoryFileSystem;

	beforeEach(() => {
		fs = new InMemoryFileSystem();
		fs.clear();
		setFileSystem(fs);
		vi.restoreAllMocks();
	});

	it('writes the override content into another story folder, overwriting prior content', async () => {
		const srcPath = 'story-a/en/prompt-templates/act/act-card-template.md';
		const destPath = 'story-b/en/prompt-templates/act/act-card-template.md';
		await fs.writeTextFileEnsuringDir(destPath, 'dest original');
		await fs.writeTextFileEnsuringDir(srcPath, 'shared override');

		await copyStoryOverrideToStory(srcPath, 'story-b');

		expect(await fs.readTextFile(destPath)).toBe('shared override');
		expect(await fs.readTextFile(srcPath)).toBe('shared override');
	});

	it('creates the destination directory tree when missing', async () => {
		const srcPath = 'story-a/en/prompt-templates/act/act-card-template.md';
		const destPath = 'story-b/en/prompt-templates/act/act-card-template.md';
		await fs.writeTextFileEnsuringDir(srcPath, 'new override');

		expect(await fs.exists(destPath)).toBe(false);

		await copyStoryOverrideToStory(srcPath, 'story-b');

		expect(await fs.exists(destPath)).toBe(true);
		expect(await fs.readTextFile(destPath)).toBe('new override');
	});
});

describe('CRITICAL_SYSTEM_FILENAMES', () => {
	it('lists the critical system filenames', () => {
		expect([...CRITICAL_SYSTEM_FILENAMES]).toEqual(['world.md', 'act-plot.md']);
	});
});

describe('isCriticalSystemFile', () => {
	it('returns true for world.md at story root', () => {
		expect(isCriticalSystemFile('my-story/world.md', 'story')).toBe(true);
	});

	it('returns true for act-plot.md in a canonical main-line dir', () => {
		expect(isCriticalSystemFile('my-story/act-1/main-line/act-plot.md', 'story')).toBe(true);
	});

	it('returns true for act-plot.md in a forked line dir with 8-hex id', () => {
		expect(isCriticalSystemFile('my-story/act-2/a1b2c3d4/act-plot.md', 'story')).toBe(true);
	});

	it('returns true for act-plot.md in a forked line dir with named suffix', () => {
		expect(isCriticalSystemFile('my-story/act-2/a1b2c3d4-the-fork/act-plot.md', 'story')).toBe(true);
	});

	it('returns true for act-plot.md in an import-flat layout (orphaned but still loss-of-context)', () => {
		expect(isCriticalSystemFile('my-story/act-1/act-plot.md', 'story')).toBe(true);
	});

	it('returns false for world-{timestamp}.md backups', () => {
		expect(isCriticalSystemFile('my-story/world-20260501143022.md', 'story')).toBe(false);
	});

	it('returns false for world-template-id', () => {
		expect(isCriticalSystemFile('my-story/world-template-id', 'story')).toBe(false);
	});

	it('returns false for act-card.md (regenerable, not critical)', () => {
		expect(isCriticalSystemFile('my-story/act-1/main-line/act-card.md', 'story')).toBe(false);
	});

	it('returns false for character cards', () => {
		expect(isCriticalSystemFile('my-story/act-1/main-line/characters/elena-cross.md', 'story')).toBe(false);
	});

	it('returns false for debug logs', () => {
		expect(isCriticalSystemFile('my-story/main-chat.log', 'story')).toBe(false);
	});

	it('returns false when folderType is config, even for world.md basename', () => {
		expect(isCriticalSystemFile('config/world.md', 'config')).toBe(false);
	});

	it('returns false when folderType is undefined', () => {
		expect(isCriticalSystemFile('random/world.md', undefined)).toBe(false);
	});

	it('returns false when folderType is default', () => {
		expect(isCriticalSystemFile('random/world.md', 'default')).toBe(false);
	});

	it('returns false for a similarly-named file (some-world.md)', () => {
		expect(isCriticalSystemFile('my-story/some-world.md', 'story')).toBe(false);
	});
});
