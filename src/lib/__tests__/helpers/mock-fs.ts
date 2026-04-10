import { vi } from 'vitest';

/**
 * In-memory mock for @tauri-apps/plugin-fs.
 * Simulates a filesystem backed by a Map<string, string>.
 */
export function createMockFs() {
	const files = new Map<string, string>();
	const dirs = new Set<string>(['/']); // root always exists

	return {
		exists: vi.fn(async (path: string) => {
			return files.has(path) || dirs.has(path);
		}),

		readTextFile: vi.fn(async (path: string) => {
			const content = files.get(path);
			if (content === undefined) throw new Error(`File not found: ${path}`);
			return content;
		}),

		writeTextFile: vi.fn(async (path: string, content: string) => {
			files.set(path, content);
			// Auto-register parent dirs
			const parts = path.split('/');
			for (let i = 1; i < parts.length; i++) {
				dirs.add(parts.slice(0, i).join('/'));
			}
		}),

		mkdir: vi.fn(async (path: string) => {
			dirs.add(path);
		}),

		readDir: vi.fn(async (path: string) => {
			const entries: { name: string; isDirectory: boolean }[] = [];
			const prefix = path === '/' ? '' : path + '/';
			const seen = new Set<string>();

			for (const filePath of files.keys()) {
				if (filePath.startsWith(prefix)) {
					const rest = filePath.slice(prefix.length);
					const firstPart = rest.split('/')[0];
					if (firstPart && !seen.has(firstPart)) {
						seen.add(firstPart);
						entries.push({ name: firstPart, isDirectory: !rest.includes('/') || rest.indexOf('/') === rest.length - 1 });
					}
				}
			}
			for (const dir of dirs) {
				if (dir.startsWith(prefix)) {
					const rest = dir.slice(prefix.length);
					const firstPart = rest.split('/')[0];
					if (firstPart && !seen.has(firstPart)) {
						seen.add(firstPart);
						entries.push({ name: firstPart, isDirectory: true });
					}
				}
			}
			return entries;
		}),

		/** Get all stored files (for assertions). */
		getFiles: () => files,

		/** Get all directories. */
		getDirs: () => dirs,

		/** Seed a file. */
		setFile(path: string, content: string) {
			files.set(path, content);
		},

		/** Clear all. */
		clear() {
			files.clear();
			dirs.clear();
			dirs.add('/');
		}
	};
}
