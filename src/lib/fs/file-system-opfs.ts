import type { DirEntry, FileSystem } from './file-system';
import { FileSystemError } from './file-system';

function classifyOpfsError(error: unknown): FileSystemError {
	if (error instanceof DOMException) {
		switch (error.name) {
			case 'NotFoundError':
				return new FileSystemError(error.message, 'not_found', error);
			case 'NoModificationAllowedError':
			case 'InvalidModificationError':
				return new FileSystemError(error.message, 'already_exists', error);
			case 'NotAllowedError':
				return new FileSystemError(error.message, 'permission_denied', error);
			case 'TypeMismatchError':
				return new FileSystemError(error.message, 'already_exists', error);
		}
	}
	return new FileSystemError(error instanceof Error ? error.message : String(error), 'unknown', error);
}

export class OpfsFileSystem implements FileSystem {
	private root: FileSystemDirectoryHandle | undefined;
	private dirCache = new Map<string, FileSystemDirectoryHandle>();

	private async getRoot(): Promise<FileSystemDirectoryHandle> {
		if (!this.root) {
			this.root = await navigator.storage.getDirectory();
		}
		return this.root;
	}

	private invalidatePathCache(path: string): void {
		for (const key of this.dirCache.keys()) {
			if (key === path || key.startsWith(path + '/')) {
				this.dirCache.delete(key);
			}
		}
	}

	private splitPath(path: string): string[] {
		return path.split('/').filter(Boolean);
	}

	private async getParentAndNameAsync(path: string): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
		const segments = this.splitPath(path);
		if (segments.length === 0) {
			throw new FileSystemError('Cannot operate on root directory', 'unknown');
		}
		const name = segments.pop()!;
		const parent = await this.resolveDir(segments.length === 0 ? '' : segments.join('/'), true);
		return { parent, name };
	}

	private async resolveDir(dirPath: string, createIfMissing?: boolean): Promise<FileSystemDirectoryHandle> {
		if (dirPath === '') return await this.getRoot();

		const cached = this.dirCache.get(dirPath);
		if (cached) {
			const root = await this.getRoot();
			try {
				const resolved = await root.resolve(cached);
				if (resolved !== null) return cached;
			} catch {
				// stale cache entry
			}
			this.dirCache.delete(dirPath);
		}

		const segments = this.splitPath(dirPath);
		let current = await this.getRoot();
		for (let i = 0; i < segments.length; i++) {
			const segment = segments[i];
			try {
				current = await current.getDirectoryHandle(segment);
			} catch (error) {
				if (error instanceof DOMException && error.name === 'NotFoundError' && createIfMissing) {
					current = await current.getDirectoryHandle(segment, { create: true });
				} else if (error instanceof DOMException && error.name === 'TypeMismatchError' && createIfMissing) {
					await current.removeEntry(segment);
					current = await current.getDirectoryHandle(segment, { create: true });
				} else {
					throw classifyOpfsError(error);
				}
			}
			this.dirCache.set(segments.slice(0, i + 1).join('/'), current);
		}
		return current;
	}

	async readTextFile(path: string): Promise<string> {
		try {
			const { parent, name } = await this.getParentAndNameAsync(path);
			const fileHandle = await parent.getFileHandle(name);
			const file = await fileHandle.getFile();
			return await file.text();
		} catch (error) {
			throw error instanceof FileSystemError ? error : classifyOpfsError(error);
		}
	}

	async readTextFileIfExists(path: string): Promise<string | undefined> {
		try {
			const { parent, name } = await this.getParentAndNameAsync(path);
			try {
				const fileHandle = await parent.getFileHandle(name);
				const file = await fileHandle.getFile();
				return await file.text();
			} catch (error) {
				if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')) {
					return undefined;
				}
				throw classifyOpfsError(error);
			}
		} catch (error) {
			if (error instanceof FileSystemError && (error.code === 'not_found' || error.code === 'already_exists')) {
				return undefined;
			}
			throw error;
		}
	}

	async writeTextFile(path: string, content: string, options?: { append?: boolean }): Promise<void> {
		try {
			const { parent, name } = await this.getParentAndNameAsync(path);
			let fileHandle: FileSystemFileHandle;
			try {
				fileHandle = await parent.getFileHandle(name, { create: true });
			} catch (error) {
				if (error instanceof DOMException && error.name === 'TypeMismatchError') {
					await parent.removeEntry(name, { recursive: true });
					this.invalidatePathCache(path);
					fileHandle = await parent.getFileHandle(name, { create: true });
				} else {
					throw classifyOpfsError(error);
				}
			}
			const writable = await fileHandle.createWritable({ keepExistingData: options?.append ?? false });
			try {
				if (options?.append) {
					const file = await fileHandle.getFile();
					await writable.seek(file.size);
				}
				await writable.write(content);
			} finally {
				await writable.close();
			}
		} catch (error) {
			throw error instanceof FileSystemError ? error : classifyOpfsError(error);
		}
	}

	async mkdir(path: string): Promise<void> {
		try {
			await this.resolveDir(path, true);
		} catch (error) {
			throw error instanceof FileSystemError ? error : classifyOpfsError(error);
		}
	}

	async exists(path: string): Promise<boolean> {
		const segments = this.splitPath(path);
		if (segments.length === 0) return true;
		const name = segments.pop()!;
		const parentPath = segments.join('/');
		try {
			const parent = await this.resolveDir(parentPath, false);
			try {
				await parent.getFileHandle(name);
				return true;
			} catch (error) {
				if (error instanceof DOMException && error.name === 'NotFoundError') {
					try {
						await parent.getDirectoryHandle(name);
						return true;
					} catch {
						return false;
					}
				}
				if (error instanceof DOMException && error.name === 'TypeMismatchError') {
					return true;
				}
				throw classifyOpfsError(error);
			}
		} catch (error) {
			if (error instanceof FileSystemError && error.code === 'not_found') {
				return false;
			}
			if (error instanceof FileSystemError && error.code === 'already_exists') {
				return true;
			}
			throw error;
		}
	}

	async remove(path: string): Promise<void> {
		try {
			const { parent, name } = await this.getParentAndNameAsync(path);
			await parent.removeEntry(name, { recursive: true });
			this.invalidatePathCache(path);
		} catch (error) {
			throw error instanceof FileSystemError ? error : classifyOpfsError(error);
		}
	}

	async rename(oldPath: string, newPath: string): Promise<void> {
		const srcSegments = this.splitPath(oldPath);
		if (srcSegments.length === 0) {
			throw new FileSystemError('Cannot rename root directory', 'unknown');
		}
		try {
			const { parent: srcParent, name: srcName } = await this.getParentAndNameAsync(oldPath);
			const { parent: dstParent, name: dstName } = await this.getParentAndNameAsync(newPath);

			const isDir = await this.isDirectoryHandle(srcParent, srcName);

			if (isDir) {
				await this.renameDirectory(srcParent, srcName, dstParent, dstName, oldPath, newPath);
			} else {
				await this.renameFile(srcParent, srcName, dstParent, dstName);
			}

			this.invalidatePathCache(oldPath);
		} catch (error) {
			throw error instanceof FileSystemError ? error : classifyOpfsError(error);
		}
	}

	private async isDirectoryHandle(parent: FileSystemDirectoryHandle, name: string): Promise<boolean> {
		try {
			await parent.getDirectoryHandle(name);
			return true;
		} catch {
			return false;
		}
	}

	private async renameFile(
		srcParent: FileSystemDirectoryHandle,
		srcName: string,
		dstParent: FileSystemDirectoryHandle,
		dstName: string
	): Promise<void> {
		const srcHandle = await srcParent.getFileHandle(srcName);
		const srcFile = await srcHandle.getFile();

		let dstHandle: FileSystemFileHandle;
		try {
			dstHandle = await dstParent.getFileHandle(dstName, { create: true });
		} catch (error) {
			if (error instanceof DOMException && error.name === 'TypeMismatchError') {
				await dstParent.removeEntry(dstName, { recursive: true });
				dstHandle = await dstParent.getFileHandle(dstName, { create: true });
			} else {
				throw classifyOpfsError(error);
			}
		}
		const writable = await dstHandle.createWritable();
		try {
			await writable.write(await srcFile.arrayBuffer());
		} finally {
			await writable.close();
		}

		await srcParent.removeEntry(srcName);
	}

	private async renameDirectory(
		srcParent: FileSystemDirectoryHandle,
		srcName: string,
		dstParent: FileSystemDirectoryHandle,
		dstName: string,
		oldPath: string,
		newPath: string
	): Promise<void> {
		const srcDirHandle = await srcParent.getDirectoryHandle(srcName);
		let dstDirHandle: FileSystemDirectoryHandle;
		try {
			dstDirHandle = await dstParent.getDirectoryHandle(dstName, { create: true });
		} catch (error) {
			if (error instanceof DOMException && error.name === 'TypeMismatchError') {
				await dstParent.removeEntry(dstName, { recursive: true });
				this.invalidatePathCache(newPath);
				dstDirHandle = await dstParent.getDirectoryHandle(dstName, { create: true });
			} else {
				throw classifyOpfsError(error);
			}
		}

		await this.copyDirectoryContentsWithCache(srcDirHandle, dstDirHandle, newPath);

		await srcParent.removeEntry(srcName, { recursive: true });

		this.dirCache.set(newPath, dstDirHandle);
		this.invalidatePathCache(oldPath);
	}

	private async copyDirectoryContentsWithCache(
		srcDir: FileSystemDirectoryHandle,
		dstDir: FileSystemDirectoryHandle,
		dstPath: string
	): Promise<void> {
		for await (const entry of srcDir.values()) {
			if (entry.kind === 'file') {
				const fileHandle = entry as FileSystemFileHandle;
				const file = await fileHandle.getFile();
				const dstFileHandle = await dstDir.getFileHandle(entry.name, { create: true });
				const writable = await dstFileHandle.createWritable();
				try {
					await writable.write(await file.arrayBuffer());
				} finally {
					await writable.close();
				}
			} else {
				const srcSubDir = entry as FileSystemDirectoryHandle;
				const childPath = `${dstPath}/${entry.name}`;
				const dstSubDir = await dstDir.getDirectoryHandle(entry.name, { create: true });
				this.dirCache.set(childPath, dstSubDir);
				await this.copyDirectoryContentsWithCache(srcSubDir, dstSubDir, childPath);
			}
		}
	}

	async copyFile(fromPath: string, toPath: string): Promise<void> {
		const srcSegments = this.splitPath(fromPath);
		if (srcSegments.length === 0) {
			throw new FileSystemError('Cannot copy root directory', 'unknown');
		}
		try {
			const { parent: srcParent, name: srcName } = await this.getParentAndNameAsync(fromPath);
			const { parent: dstParent, name: dstName } = await this.getParentAndNameAsync(toPath);

			const srcHandle = await srcParent.getFileHandle(srcName);
			const srcFile = await srcHandle.getFile();

			let dstHandle: FileSystemFileHandle;
			try {
				dstHandle = await dstParent.getFileHandle(dstName, { create: true });
			} catch (error) {
				if (error instanceof DOMException && error.name === 'TypeMismatchError') {
					await dstParent.removeEntry(dstName, { recursive: true });
					this.invalidatePathCache(toPath);
					dstHandle = await dstParent.getFileHandle(dstName, { create: true });
				} else {
					throw classifyOpfsError(error);
				}
			}
			const writable = await dstHandle.createWritable();
			try {
				await writable.write(await srcFile.arrayBuffer());
			} finally {
				await writable.close();
			}
		} catch (error) {
			throw error instanceof FileSystemError ? error : classifyOpfsError(error);
		}
	}

	async readDir(path: string): Promise<DirEntry[]> {
		try {
			const dir = await this.resolveDir(path, false);
			const entries: DirEntry[] = [];
			for await (const handle of dir.values()) {
				entries.push({
					name: handle.name,
					isDirectory: handle.kind === 'directory',
				});
			}
			return entries;
		} catch (error) {
			throw error instanceof FileSystemError ? error : classifyOpfsError(error);
		}
	}

	async readBinaryFile(path: string): Promise<Uint8Array> {
		try {
			const { parent, name } = await this.getParentAndNameAsync(path);
			const fileHandle = await parent.getFileHandle(name);
			const file = await fileHandle.getFile();
			return new Uint8Array(await file.arrayBuffer());
		} catch (error) {
			throw error instanceof FileSystemError ? error : classifyOpfsError(error);
		}
	}

	async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
		try {
			const { parent, name } = await this.getParentAndNameAsync(path);
			const fileHandle = await parent.getFileHandle(name, { create: true });
			const writable = await fileHandle.createWritable();
			try {
				await writable.write(data.buffer as ArrayBuffer);
			} finally {
				await writable.close();
			}
		} catch (error) {
			throw error instanceof FileSystemError ? error : classifyOpfsError(error);
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
