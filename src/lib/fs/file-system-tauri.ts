import {
	BaseDirectory,
	copyFile as tauriCopy,
	exists as tauriExists,
	mkdir as tauriMkdir,
	readDir as tauriReadDir,
	readFile as tauriReadBinary,
	readTextFile as tauriRead,
	remove as tauriRemove,
	rename as tauriRename,
	writeFile as tauriWriteBinary,
	writeTextFile as tauriWrite,
} from '@tauri-apps/plugin-fs';

import type { DirEntry, FileSystem } from './file-system';
import { FileSystemError } from './file-system';

const BD = BaseDirectory.AppData;

function isAlreadyExistMessage(msg: string) {
	const m = msg.toLowerCase();
	return m.includes('already exists');
}

function isPermissionDeniedMessage(msg: string) {
	const m = msg.toLowerCase();
	return m.includes('permission') || m.includes('denied') || m.includes('not allowed');
}

function isNotFoundMessage(message: string): boolean {
	const msg = message.toLowerCase();
	return msg.includes('not found') || msg.includes('no such file') || msg.includes('does not exist') || msg.includes('cannot find');
}

function resolveErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	return String(error);
}

function classifyTauriError(error: unknown): FileSystemError {
	const msg = resolveErrorMessage(error);
	if (isNotFoundMessage(msg)) {
		return new FileSystemError(msg, 'not_found', error);
	}
	if (isAlreadyExistMessage(msg)) {
		return new FileSystemError(msg, 'already_exists', error);
	}
	if (isPermissionDeniedMessage(msg)) {
		return new FileSystemError(msg, 'permission_denied', error);
	}
	return new FileSystemError(msg, 'unknown', error);
}

export class TauriFileSystem implements FileSystem {
	async readTextFile(path: string): Promise<string> {
		try {
			return await tauriRead(path, { baseDir: BD });
		} catch (error) {
			throw classifyTauriError(error);
		}
	}

	async readTextFileIfExists(path: string): Promise<string | undefined> {
		try {
			return await tauriRead(path, { baseDir: BD });
		} catch (error) {
			if (isNotFoundMessage(resolveErrorMessage(error))) {
				return undefined;
			}
			throw classifyTauriError(error);
		}
	}

	async writeTextFile(path: string, content: string, options?: { append?: boolean }): Promise<void> {
		try {
			await tauriWrite(path, content, { baseDir: BD, append: options?.append ?? false });
		} catch (error) {
			throw classifyTauriError(error);
		}
	}

	async mkdir(path: string): Promise<void> {
		try {
			await tauriMkdir(path, { baseDir: BD, recursive: true });
		} catch (error) {
			throw classifyTauriError(error);
		}
	}

	async exists(path: string): Promise<boolean> {
		return tauriExists(path, { baseDir: BD });
	}

	async remove(path: string): Promise<void> {
		try {
			await tauriRemove(path, { baseDir: BD, recursive: true });
		} catch (error) {
			throw classifyTauriError(error);
		}
	}

	async rename(oldPath: string, newPath: string): Promise<void> {
		try {
			await tauriRename(oldPath, newPath, {
				oldPathBaseDir: BD,
				newPathBaseDir: BD,
			});
		} catch (error) {
			throw classifyTauriError(error);
		}
	}

	async copyFile(fromPath: string, toPath: string): Promise<void> {
		try {
			await tauriCopy(fromPath, toPath, {
				fromPathBaseDir: BD,
				toPathBaseDir: BD,
			});
		} catch (error) {
			throw classifyTauriError(error);
		}
	}

	async readDir(path: string): Promise<DirEntry[]> {
		try {
			const entries = await tauriReadDir(path, { baseDir: BD });
			return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory }));
		} catch (error) {
			throw classifyTauriError(error);
		}
	}

	async readBinaryFile(path: string): Promise<Uint8Array> {
		try {
			return await tauriReadBinary(path, { baseDir: BD });
		} catch (error) {
			throw classifyTauriError(error);
		}
	}

	async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
		try {
			await tauriWriteBinary(path, data, { baseDir: BD });
		} catch (error) {
			throw classifyTauriError(error);
		}
	}

	async ensureDir(path: string): Promise<void> {
		await this.mkdir(path);
	}

	async writeTextFileEnsuringDir(path: string, content: string, options?: { append?: boolean }): Promise<void> {
		const lastSlash = path.lastIndexOf('/');
		if (lastSlash > 0) {
			await this.mkdir(path.substring(0, lastSlash));
		}
		await this.writeTextFile(path, content, options);
	}
}
