import type { DirEntry, FileSystem } from './file-system';
import { FileSystemError } from './file-system';

type Entry = { type: 'file'; content: string } | { type: 'dir' };

export class InMemoryFileSystem implements FileSystem {
	private files = new Map<string, Entry>();

	private normalizePath(path: string): string {
		const parts = path.split('/').filter(Boolean);
		return parts.join('/');
	}

	private parentPath(path: string): string {
		const parts = path.split('/');
		parts.pop();
		return parts.join('/');
	}

	async readTextFile(path: string): Promise<string> {
		const normalized = this.normalizePath(path);
		const entry = this.files.get(normalized);
		if (!entry || entry.type !== 'file') {
			throw new FileSystemError(`File not found: ${path}`, 'not_found');
		}
		return entry.content;
	}

	async readTextFileIfExists(path: string): Promise<string | undefined> {
		const normalized = this.normalizePath(path);
		const entry = this.files.get(normalized);
		if (!entry || entry.type !== 'file') return undefined;
		return entry.content;
	}

	async writeTextFile(path: string, content: string, options?: { append?: boolean }): Promise<void> {
		const normalized = this.normalizePath(path);
		const parentDir = this.parentPath(normalized);
		if (parentDir) {
			const parts = parentDir.split('/');
			let current = '';
			for (const part of parts) {
				current = current ? `${current}/${part}` : part;
				if (!this.files.has(current)) {
					this.files.set(current, { type: 'dir' });
				}
			}
		}
		const existing = this.files.get(normalized);
		const existingContent = existing?.type === 'file' ? existing.content : '';
		this.files.set(normalized, {
			type: 'file',
			content: options?.append ? existingContent + content : content,
		});
	}

	async mkdir(path: string): Promise<void> {
		const normalized = this.normalizePath(path);
		const parts = normalized.split('/');
		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!this.files.has(current)) {
				this.files.set(current, { type: 'dir' });
			}
		}
	}

	async exists(path: string): Promise<boolean> {
		const normalized = this.normalizePath(path);
		return this.files.has(normalized);
	}

	async remove(path: string): Promise<void> {
		const normalized = this.normalizePath(path);
		const prefix = normalized + '/';
		for (const key of this.files.keys()) {
			if (key === normalized || key.startsWith(prefix)) {
				this.files.delete(key);
			}
		}
	}

	async rename(oldPath: string, newPath: string): Promise<void> {
		const normalizedOld = this.normalizePath(oldPath);
		const normalizedNew = this.normalizePath(newPath);
		const entry = this.files.get(normalizedOld);
		if (!entry) {
			throw new FileSystemError(`File not found: ${oldPath}`, 'not_found');
		}
		this.files.set(normalizedNew, entry);
		this.files.delete(normalizedOld);
		// Move child entries if this is a directory
		const prefix = normalizedOld + '/';
		for (const key of [...this.files.keys()]) {
			if (key.startsWith(prefix)) {
				const newKey = normalizedNew + key.slice(normalizedOld.length);
				this.files.set(newKey, this.files.get(key)!);
				this.files.delete(key);
			}
		}
	}

	async copyFile(fromPath: string, toPath: string): Promise<void> {
		const normalizedFrom = this.normalizePath(fromPath);
		const normalizedTo = this.normalizePath(toPath);
		const entry = this.files.get(normalizedFrom);
		if (!entry || entry.type !== 'file') {
			throw new FileSystemError(`File not found: ${fromPath}`, 'not_found');
		}
		this.files.set(normalizedTo, { ...entry });
	}

	async readDir(path: string): Promise<DirEntry[]> {
		const normalized = this.normalizePath(path);
		if (normalized && (!this.files.has(normalized) || this.files.get(normalized)!.type !== 'dir')) {
			throw new FileSystemError(`Directory not found: ${path}`, 'not_found');
		}
		const prefix = normalized ? normalized + '/' : '';
		const entries: DirEntry[] = [];
		const seen = new Set<string>();
		for (const [key, entry] of this.files) {
			if (!key.startsWith(prefix)) continue;
			const rest = key.slice(prefix.length);
			if (!rest) continue;
			const name = rest.split('/')[0];
			if (seen.has(name)) continue;
			seen.add(name);
			entries.push({
				name,
				isDirectory: entry.type === 'dir',
			});
		}
		return entries;
	}

	async readBinaryFile(path: string): Promise<Uint8Array> {
		const content = await this.readTextFile(path);
		return new TextEncoder().encode(content);
	}

	async writeBinaryFile(_path: string, _data: Uint8Array): Promise<void> {
		throw new Error('writeBinaryFile not implemented in InMemoryFileSystem');
	}

	async ensureDir(path: string): Promise<void> {
		await this.mkdir(path);
	}

	async writeTextFileEnsuringDir(path: string, content: string, options?: { append?: boolean }): Promise<void> {
		const normalized = this.normalizePath(path);
		const lastSlash = normalized.lastIndexOf('/');
		if (lastSlash > 0) {
			await this.mkdir(normalized.substring(0, lastSlash));
		}
		await this.writeTextFile(path, content, options);
	}

	clear(): void {
		this.files.clear();
		this.files.set('', { type: 'dir' });
	}
}
