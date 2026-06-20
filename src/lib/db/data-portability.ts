import { getDatabase } from '$lib/db/database';
import { isTauriSync } from '$lib/runtime';
import { fs } from '$lib/fs/file-system';
import { loadManifest, type ConfigAssetEntry } from '$lib/fs/config-manifest';
import { log } from '$lib/logging/logger';
import JSZip from 'jszip';

// --- Hash helper ---

async function hashContent(content: string): Promise<string> {
	const normalized = content.replaceAll('\r\n', '\n');
	const data = new TextEncoder().encode(normalized);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

// --- Recursive directory walker ---

interface FileEntry {
	zipPath: string;
	fsPath: string;
}

async function walkDir(dirPath: string, zipPrefix: string): Promise<FileEntry[]> {
	const entries = await fs.readDir(dirPath);
	const files: FileEntry[] = [];

	for (const entry of entries) {
		const childFsPath = dirPath ? `${dirPath}/${entry.name}` : entry.name;
		const childZipPath = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name;

		if (entry.isDirectory) {
			files.push(...(await walkDir(childFsPath, childZipPath)));
		} else {
			files.push({ zipPath: childZipPath, fsPath: childFsPath });
		}
	}

	return files;
}

// --- Config filtering ---

async function isUserEditedConfig(configPath: string, content: string, manifest: Map<string, ConfigAssetEntry>): Promise<boolean> {
	const entry = manifest.get(configPath);
	if (!entry) return true;

	const diskHash = await hashContent(content);
	const knownHashes = [...entry.oldHashes, entry.hash].filter((h): h is string => h !== null);
	return !knownHashes.includes(diskHash);
}

// --- Story folder names from DB ---

async function getStoryFolderNames(): Promise<string[]> {
	const db = getDatabase();
	const rows = await db.select<{ folder_name: string }[]>('SELECT folder_name FROM story_folders');
	return rows.map((r) => r.folder_name);
}

// --- Database binary read ---

async function readMainDbBinary(): Promise<Uint8Array> {
	const db = getDatabase();
	if ('export' in db && typeof db.export === 'function') {
		return (db as { export: () => Uint8Array }).export();
	}

	if (isTauriSync()) {
		const { readFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
		return await readFile('hiyori.db', { baseDir: BaseDirectory.AppData });
	}

	throw new Error('Cannot read main database binary');
}

async function readMemoryDbBinary(): Promise<Uint8Array | null> {
	try {
		const { getMemoryDatabase } = await import('$lib/db/memory-database');
		const { isMemoryCapable } = await import('$lib/stores/settings.svelte');
		if (!isMemoryCapable()) return null;

		const memDb = getMemoryDatabase();
		if ('export' in memDb && typeof memDb.export === 'function') {
			return (memDb as { export: () => Uint8Array }).export();
		}

		if (isTauriSync()) {
			const { readFile, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
			const memExists = await exists('hiyori-memory.db', { baseDir: BaseDirectory.AppData });
			if (!memExists) return null;
			return await readFile('hiyori-memory.db', { baseDir: BaseDirectory.AppData });
		}
	} catch {
		return null;
	}
	return null;
}

// --- Export ---

export async function exportGameData(onProgress?: (percent: number) => void): Promise<Uint8Array> {
	const zip = new JSZip();

	await exportStoryFolders(zip);
	await exportLogFiles(zip);

	const mainDb = await readMainDbBinary();
	zip.file('database/main-db/hiyori.db', mainDb);

	const memoryDb = await readMemoryDbBinary();
	if (memoryDb) {
		zip.file('database/memory-db/hiyori-memory.db', memoryDb);
	}

	return await zip.generateAsync(
		{ type: 'uint8array', compression: 'DEFLATE' },
		onProgress ? (metadata) => onProgress(metadata.percent) : undefined
	);
}

export async function exportConfigData(onProgress?: (percent: number) => void): Promise<Uint8Array> {
	const zip = new JSZip();
	const manifest = loadManifest();

	await exportConfigFiles(zip, manifest);

	const settingsJson = typeof localStorage !== 'undefined' ? localStorage.getItem('hiyori-settings') : null;
	if (settingsJson) {
		zip.file('user-data/config/settings.json', settingsJson);
	}

	return await zip.generateAsync(
		{ type: 'uint8array', compression: 'DEFLATE' },
		onProgress ? (metadata) => onProgress(metadata.percent) : undefined
	);
}

async function exportConfigFiles(zip: JSZip, manifest: Map<string, ConfigAssetEntry>): Promise<void> {
	const configDir = 'config';
	let configExists = false;
	try {
		configExists = await fs.exists(configDir);
	} catch {
		return;
	}
	if (!configExists) return;

	const files = await walkDir(configDir, 'user-data/config');
	for (const { fsPath, zipPath } of files) {
		try {
			const content = await fs.readTextFile(fsPath);
			const relativeConfigPath = fsPath.slice('config/'.length);

			if (await isUserEditedConfig(relativeConfigPath, content, manifest)) {
				zip.file(zipPath, content);
			}
		} catch (err) {
			await log.warn('export', `Skipping config file ${fsPath}: ${err}`);
		}
	}
}

async function exportLogFiles(zip: JSZip): Promise<void> {
	const logsDir = 'logs';
	let logsExists = false;
	try {
		logsExists = await fs.exists(logsDir);
	} catch {
		return;
	}
	if (!logsExists) return;

	const files = await walkDir(logsDir, 'user-data/logs');
	for (const { fsPath, zipPath } of files) {
		try {
			const content = await fs.readTextFile(fsPath);
			zip.file(zipPath, content);
		} catch (err) {
			await log.warn('export', `Skipping log file ${fsPath}: ${err}`);
		}
	}
}

async function exportStoryFolders(zip: JSZip): Promise<void> {
	const folderNames = await getStoryFolderNames();

	for (const folderName of folderNames) {
		let exists = false;
		try {
			exists = await fs.exists(folderName);
		} catch {
			continue;
		}
		if (!exists) continue;

		const files = await walkDir(folderName, `user-data/stories/${folderName}`);
		for (const { fsPath, zipPath } of files) {
			try {
				const content = await fs.readTextFile(fsPath);
				zip.file(zipPath, content);
			} catch (err) {
				await log.warn('export', `Skipping story file ${fsPath}: ${err}`);
			}
		}
	}
}

// --- Import ---

export async function importGameData(data: Uint8Array): Promise<void> {
	const zip = await JSZip.loadAsync(data);

	await importDatabase(zip);
	await importStoryFolders(zip);
}

export async function importConfigData(data: Uint8Array): Promise<void> {
	const zip = await JSZip.loadAsync(data);

	await importSettings(zip);
	await importConfigFiles(zip);
}

async function importDatabase(zip: JSZip): Promise<void> {
	const mainDbFile = zip.file('database/main-db/hiyori.db');
	if (!mainDbFile) throw new Error('Invalid backup: missing database/main-db/hiyori.db');

	const mainDbBinary = await mainDbFile.async('uint8array');
	const db = getDatabase();

	if ('importFromData' in db && typeof (db as any).importFromData === 'function') {
		await (db as any).importFromData(mainDbBinary);
		await db.flush();
	} else if (isTauriSync()) {
		const { writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
		await writeFile('hiyori.db', mainDbBinary, { baseDir: BaseDirectory.AppData });
	}

	const memoryDbFile = zip.file('database/memory-db/hiyori-memory.db');
	if (memoryDbFile) {
		const memoryDbBinary = await memoryDbFile.async('uint8array');
		if (isTauriSync()) {
			const { writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
			await writeFile('hiyori-memory.db', memoryDbBinary, { baseDir: BaseDirectory.AppData });
		}
	}
}

async function importSettings(zip: JSZip): Promise<void> {
	const settingsFile = zip.file('user-data/config/settings.json');
	if (!settingsFile) return;

	const settingsJson = await settingsFile.async('string');
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem('hiyori-settings', settingsJson);
	}
}

async function importStoryFolders(zip: JSZip): Promise<void> {
	const existingFolders = await getStoryFolderNames();
	for (const folderName of existingFolders) {
		try {
			await fs.remove(folderName);
		} catch {
			// Folder may already be gone
		}
	}

	const storyPrefix = 'user-data/stories/';
	const storyFiles: string[] = [];

	zip.forEach((relativePath) => {
		if (relativePath.startsWith(storyPrefix)) {
			storyFiles.push(relativePath);
		}
	});

	if (storyFiles.length === 0) return;

	const folderNames = new Set<string>();
	for (const path of storyFiles) {
		const afterPrefix = path.slice(storyPrefix.length);
		const slashIdx = afterPrefix.indexOf('/');
		if (slashIdx > 0) {
			folderNames.add(afterPrefix.slice(0, slashIdx));
		}
	}

	for (const folderName of folderNames) {
		await fs.mkdir(folderName);

		const folderPrefix = `${storyPrefix}${folderName}/`;
		const filesToExtract = storyFiles.filter((p) => p.startsWith(folderPrefix));

		for (const zipPath of filesToExtract) {
			const zipEntry = zip.file(zipPath);
			if (!zipEntry) continue;

			const content = await zipEntry.async('string');
			const relPath = zipPath.slice(folderPrefix.length);
			const fsPath = `${folderName}/${relPath}`;

			await fs.writeTextFileEnsuringDir(fsPath, content);
		}
	}
}

async function importConfigFiles(zip: JSZip): Promise<void> {
	const configPrefix = 'user-data/config/';
	const filesToExtract: string[] = [];

	zip.forEach((relativePath) => {
		if (relativePath.startsWith(configPrefix) && !relativePath.endsWith('/')) {
			if (!relativePath.endsWith('settings.json')) {
				filesToExtract.push(relativePath);
			}
		}
	});

	for (const zipPath of filesToExtract) {
		const zipEntry = zip.file(zipPath);
		if (!zipEntry) continue;

		const content = await zipEntry.async('string');
		const relPath = zipPath.slice('user-data/'.length);
		await fs.writeTextFileEnsuringDir(relPath, content);
	}
}

// --- Download / Upload helpers ---

export async function downloadExport(data: Uint8Array, filename: string): Promise<void> {
	if (isTauriSync()) {
		const { save } = await import('@tauri-apps/plugin-dialog');
		const { writeFile } = await import('@tauri-apps/plugin-fs');
		const filePath = await save({
			defaultPath: filename,
			filters: [{ name: 'Backup', extensions: ['zip'] }],
		});
		if (!filePath) return;
		await writeFile(filePath, data);
		return;
	}

	const blob = new Blob([new Uint8Array(data)], { type: 'application/zip' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

export function readFileAsUint8Array(file: File): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			if (reader.result instanceof ArrayBuffer) {
				resolve(new Uint8Array(reader.result));
			} else {
				reject(new Error('Failed to read file'));
			}
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsArrayBuffer(file);
	});
}
