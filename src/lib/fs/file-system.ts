import { checkIsTauri } from '$lib/runtime';

export interface DirEntry {
	name: string;
	isDirectory: boolean;
}

export type FileSystemErrorCode = 'not_found' | 'already_exists' | 'permission_denied' | 'unknown';

export class FileSystemError extends Error {
	constructor(
		message: string,
		public readonly code: FileSystemErrorCode,
		public readonly cause?: unknown
	) {
		super(message);
		this.name = 'FileSystemError';
	}
}

export interface FileSystem {
	readTextFile(path: string): Promise<string>;
	readTextFileIfExists(path: string): Promise<string | undefined>;
	writeTextFile(path: string, content: string, options?: { append?: boolean }): Promise<void>;
	mkdir(path: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	remove(path: string): Promise<void>;
	rename(oldPath: string, newPath: string): Promise<void>;
	copyFile(fromPath: string, toPath: string): Promise<void>;
	readDir(path: string): Promise<DirEntry[]>;
	ensureDir(path: string): Promise<void>;
	writeTextFileEnsuringDir(path: string, content: string, options?: { append?: boolean }): Promise<void>;
}

let backend: FileSystem | undefined;

/**
 * Get the file system backend.
 *
 * Must be called after initFileSystem() or setFileSystem().
 * Throws if no backend has been initialized.
 */
export function getFileSystem(): FileSystem {
	if (!backend) {
		throw new Error('File system not initialized. Call initFileSystem() first.');
	}
	return backend;
}

/**
 * Lazy proxy that delegates every property access to the current backend.
 * Safe to use at module level — calls getFileSystem() at actual-use time.
 */
export const fs: FileSystem = new Proxy({} as FileSystem, {
	get(_, prop) {
		const target = getFileSystem();
		const value = Reflect.get(target, prop);
		return typeof value === 'function' ? value.bind(target) : value;
	},
});

/**
 * Asynchronously initialize the file system backend.
 * Uses dynamic import based on runtime detection.
 */
export async function initFileSystem(): Promise<FileSystem> {
	if (backend) return backend;

	if (await checkIsTauri()) {
		const { TauriFileSystem } = await import('./file-system-tauri');
		backend = new TauriFileSystem();
	} else if (typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory) {
		const { OpfsFileSystem } = await import('./file-system-opfs');
		backend = new OpfsFileSystem();
	} else {
		throw new FileSystemError('No file system backend available: neither Tauri nor OPFS runtime detected', 'unknown');
	}

	return backend!;
}

export function setFileSystem(fs: FileSystem): void {
	backend = fs;
}
