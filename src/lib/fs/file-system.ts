import { isTauri } from '@tauri-apps/api/core';

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

import { TauriFileSystem } from './file-system-tauri';
import { InMemoryFileSystem } from './file-system-in-memory';
export { TauriFileSystem } from './file-system-tauri';
export { OpfsFileSystem } from './file-system-opfs';
export { InMemoryFileSystem } from './file-system-in-memory';

let backend: FileSystem | undefined;

function checkIsTauri(): boolean {
	try {
		return isTauri();
	} catch {
		return false;
	}
}

/**
 * Get the file system backend.
 *
 * In Tauri environments, auto-creates a TauriFileSystem on first call.
 * In non-Tauri environments (tests, dev), falls back to InMemoryFileSystem.
 * Tests that need spy/mock behavior should call setFileSystem() explicitly.
 */
export function getFileSystem(): FileSystem {
	if (backend) return backend;

	if (checkIsTauri()) {
		backend = new TauriFileSystem();
	} else {
		console.warn(
			'File system backend not explicitly set; falling back to InMemoryFileSystem. Data will not persist. Call setFileSystem() or initFileSystem() first.'
		);
		backend = new InMemoryFileSystem();
	}
	return backend;
}

/**
 * Asynchronously initialize the file system backend.
 * Uses `isTauri()` to detect the runtime, falling back to OPFS detection.
 *
 * Call this during app initialization in non-Tauri environments
 * (e.g. standalone web builds). In Tauri, getFileSystem() auto-initializes.
 */
export async function initFileSystem(): Promise<FileSystem> {
	if (backend) return backend;

	if (checkIsTauri()) {
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
