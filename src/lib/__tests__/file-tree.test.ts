import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryFileSystem } from '$lib/fs/file-system-in-memory';
import { setFileSystem } from '$lib/fs/file-system';
import * as dbStoryFolders from '$lib/db/story-folders';
import { readDirectoryNodes, classifyManagedConfig, getFolderType } from '$lib/fs/file-tree';

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

		it('does not set folderType on file nodes', async () => {
			vi.spyOn(dbStoryFolders, 'getAllFolderNames').mockResolvedValue([]);

			await fs.writeTextFile('config/test.md', 'test');

			const nodes = await readDirectoryNodes('config');
			const file = nodes.find((n) => n.name === 'test.md');
			expect(file!.isDirectory).toBe(false);
			expect(file!.folderType).toBeUndefined();
			expect(file!.managedConfig).toBeUndefined();
		});
	});
});
