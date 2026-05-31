import {
	readTextFile as tauriRead,
	readFile as tauriReadBinary,
	writeTextFile as tauriWrite,
	mkdir as tauriMkdir,
	exists as tauriExists,
	remove as tauriRemove,
	rename as tauriRename,
	copyFile as tauriCopy,
	readDir as tauriReadDir,
	BaseDirectory,
} from '@tauri-apps/plugin-fs';

import type { DirEntry, FileSystem } from './file-system';
import { FileSystemError } from './file-system';

const BD = BaseDirectory.AppData;

function classifyTauriError(error: unknown): FileSystemError {
	if (error instanceof Error) {
		const msg = error.message.toLowerCase();
		if (msg.includes('not found') || msg.includes('no such file') || msg.includes('does not exist')) {
			return new FileSystemError(error.message, 'not_found', error);
		}
		if (msg.includes('already exists')) {
			return new FileSystemError(error.message, 'already_exists', error);
		}
		if (msg.includes('permission') || msg.includes('denied') || msg.includes('not allowed')) {
			return new FileSystemError(error.message, 'permission_denied', error);
		}
	}
	return new FileSystemError(error instanceof Error ? error.message : String(error), 'unknown', error);
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
			if (error instanceof Error) {
				const msg = error.message.toLowerCase();
				if (msg.includes('not found') || msg.includes('no such file') || msg.includes('does not exist')) {
					return undefined;
				}
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
