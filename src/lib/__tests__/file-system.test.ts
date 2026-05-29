import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryFileSystem } from '$lib/fs/file-system-in-memory';
import type { FileSystem } from '$lib/fs/file-system';

function createTestSubject(): FileSystem {
	const fs = new InMemoryFileSystem();
	fs.clear();
	return fs;
}

describe('FileSystem contract — InMemoryFileSystem', () => {
	let subject: FileSystem;

	beforeEach(() => {
		subject = createTestSubject();
	});

	describe('writeTextFile / readTextFile', () => {
		it('writes and reads a text file', async () => {
			await subject.writeTextFile('hello.txt', 'Hello, world!');
			const content = await subject.readTextFile('hello.txt');
			expect(content).toBe('Hello, world!');
		});

		it('overwrites existing content by default', async () => {
			await subject.writeTextFile('file.txt', 'first');
			await subject.writeTextFile('file.txt', 'second');
			const content = await subject.readTextFile('file.txt');
			expect(content).toBe('second');
		});

		it('appends content when append option is true', async () => {
			await subject.writeTextFile('log.txt', 'line1\n');
			await subject.writeTextFile('log.txt', 'line2\n', { append: true });
			const content = await subject.readTextFile('log.txt');
			expect(content).toBe('line1\nline2\n');
		});

		it('throws when reading non-existent file', async () => {
			await expect(subject.readTextFile('nonexistent.txt')).rejects.toThrow();
		});

		it('auto-creates parent directories', async () => {
			await subject.writeTextFile('deep/nested/file.txt', 'content');
			const content = await subject.readTextFile('deep/nested/file.txt');
			expect(content).toBe('content');
			expect(await subject.exists('deep/nested')).toBe(true);
		});
	});

	describe('readTextFileIfExists', () => {
		it('returns content when file exists', async () => {
			await subject.writeTextFile('exists.txt', 'content');
			const result = await subject.readTextFileIfExists('exists.txt');
			expect(result).toBe('content');
		});

		it('returns undefined when file does not exist', async () => {
			const result = await subject.readTextFileIfExists('nonexistent.txt');
			expect(result).toBeUndefined();
		});
	});

	describe('mkdir', () => {
		it('creates a directory', async () => {
			await subject.mkdir('stories');
			await subject.writeTextFile('stories/test.txt', 'data');
			const content = await subject.readTextFile('stories/test.txt');
			expect(content).toBe('data');
		});

		it('creates nested directories recursively', async () => {
			await subject.mkdir('a/b/c');
			await subject.writeTextFile('a/b/c/file.txt', 'nested');
			const content = await subject.readTextFile('a/b/c/file.txt');
			expect(content).toBe('nested');
		});

		it('does not error on existing directory', async () => {
			await subject.mkdir('dir');
			await subject.mkdir('dir');
			const exists = await subject.exists('dir');
			expect(exists).toBe(true);
		});
	});

	describe('exists', () => {
		it('returns true for existing file', async () => {
			await subject.writeTextFile('file.txt', 'content');
			expect(await subject.exists('file.txt')).toBe(true);
		});

		it('returns true for existing directory', async () => {
			await subject.mkdir('mydir');
			expect(await subject.exists('mydir')).toBe(true);
		});

		it('returns false for non-existent path', async () => {
			expect(await subject.exists('nonexistent')).toBe(false);
		});
	});

	describe('remove', () => {
		it('removes a file', async () => {
			await subject.writeTextFile('file.txt', 'content');
			await subject.remove('file.txt');
			expect(await subject.exists('file.txt')).toBe(false);
		});

		it('removes a directory recursively', async () => {
			await subject.mkdir('dir/sub');
			await subject.writeTextFile('dir/sub/file.txt', 'content');
			await subject.remove('dir');
			expect(await subject.exists('dir')).toBe(false);
			expect(await subject.exists('dir/sub/file.txt')).toBe(false);
		});
	});

	describe('rename', () => {
		it('renames a file', async () => {
			await subject.writeTextFile('old.txt', 'content');
			await subject.rename('old.txt', 'new.txt');
			expect(await subject.exists('old.txt')).toBe(false);
			expect(await subject.readTextFile('new.txt')).toBe('content');
		});

		it('renames a directory with contents', async () => {
			await subject.mkdir('olddir/sub');
			await subject.writeTextFile('olddir/file.txt', 'data');
			await subject.writeTextFile('olddir/sub/nested.txt', 'nested');
			await subject.rename('olddir', 'newdir');
			expect(await subject.exists('olddir')).toBe(false);
			expect(await subject.readTextFile('newdir/file.txt')).toBe('data');
			expect(await subject.readTextFile('newdir/sub/nested.txt')).toBe('nested');
		});

		it('throws when renaming non-existent path', async () => {
			await expect(subject.rename('nonexistent.txt', 'new.txt')).rejects.toThrow();
		});
	});

	describe('copyFile', () => {
		it('copies a file', async () => {
			await subject.writeTextFile('original.txt', 'copy me');
			await subject.copyFile('original.txt', 'copy.txt');
			expect(await subject.readTextFile('original.txt')).toBe('copy me');
			expect(await subject.readTextFile('copy.txt')).toBe('copy me');
		});
	});

	describe('readDir', () => {
		it('lists directory entries', async () => {
			await subject.mkdir('mydir/sub');
			await subject.writeTextFile('mydir/file1.txt', 'a');
			await subject.writeTextFile('mydir/file2.txt', 'b');

			const entries = await subject.readDir('mydir');
			const names = entries.map((e) => e.name).sort();
			expect(names).toContain('file1.txt');
			expect(names).toContain('file2.txt');
			expect(names).toContain('sub');

			const subEntry = entries.find((e) => e.name === 'sub');
			expect(subEntry?.isDirectory).toBe(true);

			const fileEntry = entries.find((e) => e.name === 'file1.txt');
			expect(fileEntry?.isDirectory).toBe(false);
		});

		it('returns empty array for empty directory', async () => {
			await subject.mkdir('empty');
			const entries = await subject.readDir('empty');
			expect(entries).toEqual([]);
		});
	});

	describe('ensureDir', () => {
		it('creates directory if it does not exist', async () => {
			await subject.ensureDir('new/dir');
			const exists = await subject.exists('new/dir');
			expect(exists).toBe(true);
		});

		it('does not error if directory exists', async () => {
			await subject.mkdir('existing');
			await subject.ensureDir('existing');
			expect(await subject.exists('existing')).toBe(true);
		});
	});

	describe('writeTextFileEnsuringDir', () => {
		it('creates parent directory and writes file', async () => {
			await subject.writeTextFileEnsuringDir('deep/nested/file.txt', 'content');
			const content = await subject.readTextFile('deep/nested/file.txt');
			expect(content).toBe('content');
		});

		it('writes to existing directory', async () => {
			await subject.mkdir('existing');
			await subject.writeTextFileEnsuringDir('existing/file.txt', 'data');
			expect(await subject.readTextFile('existing/file.txt')).toBe('data');
		});

		it('supports append mode', async () => {
			await subject.writeTextFileEnsuringDir('log/app.log', 'line1\n', { append: false });
			await subject.writeTextFileEnsuringDir('log/app.log', 'line2\n', { append: true });
			const content = await subject.readTextFile('log/app.log');
			expect(content).toBe('line1\nline2\n');
		});
	});
});
