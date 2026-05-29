import { InMemoryFileSystem } from '$lib/fs/file-system-in-memory';
import { vi } from 'vitest';

/**
 * In-memory mock for the FileSystem abstraction.
 * Returns a real InMemoryFileSystem instance wrapped with vi.fn() spies
 * for all methods, plus a clear() helper.
 */
export function createMockFs() {
	const impl = new InMemoryFileSystem();
	impl.clear();

	const spies = {
		readTextFile: vi.fn((path: string) => impl.readTextFile(path)),
		readTextFileIfExists: vi.fn((path: string) => impl.readTextFileIfExists(path)),
		writeTextFile: vi.fn((path: string, content: string, options?: { append?: boolean }) => impl.writeTextFile(path, content, options)),
		mkdir: vi.fn((path: string) => impl.mkdir(path)),
		exists: vi.fn((path: string) => impl.exists(path)),
		remove: vi.fn((path: string) => impl.remove(path)),
		rename: vi.fn((oldPath: string, newPath: string) => impl.rename(oldPath, newPath)),
		copyFile: vi.fn((fromPath: string, toPath: string) => impl.copyFile(fromPath, toPath)),
		readDir: vi.fn((path: string) => impl.readDir(path)),
		ensureDir: vi.fn((path: string) => impl.ensureDir(path)),
		writeTextFileEnsuringDir: vi.fn((path: string, content: string, options?: { append?: boolean }) =>
			impl.writeTextFileEnsuringDir(path, content, options)
		),
	};

	return {
		...spies,
		/** Clear all stored files and directories. */
		clear() {
			impl.clear();
		},
	};
}
