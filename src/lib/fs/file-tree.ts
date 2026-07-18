import { fs } from '$lib/fs/file-system';
import { isTauriSync } from '$lib/runtime';
import JSZip from 'jszip';
import * as dbStoryFolders from '$lib/db/story-folders';
import { loadManifest, getBundledContent, hashContent } from '$lib/fs/config-manifest';

const manifest = loadManifest();

export type FolderType = 'story' | 'config' | 'default';
export type ManagedConfigKind = 'managed' | 'obsolete' | 'story-override';

export const CRITICAL_SYSTEM_FILENAMES = ['world.md', 'act-plot.md'] as const;

export interface FileNode {
	id: string;
	name: string;
	isDirectory: boolean;
	folderType?: FolderType;
	managedConfig?: ManagedConfigKind;
	children?: FileNode[];
}

export function getFolderType(path: string): FolderType {
	if (path === 'config' || path.startsWith('config/')) return 'config';
	return 'default';
}

export function isCriticalSystemFile(filePath: string, folderType: FolderType | undefined): boolean {
	if (folderType !== 'story') return false;
	const basename = filePath.split('/').pop() ?? filePath;
	return (CRITICAL_SYSTEM_FILENAMES as readonly string[]).includes(basename);
}

export function classifyManagedConfig(filePath: string, folderType: FolderType | undefined): ManagedConfigKind | null {
	if (!filePath.endsWith('.md') && !filePath.endsWith('.yaml') && !filePath.endsWith('.yml')) {
		return null;
	}

	if (folderType === 'config') {
		const configPath = filePath.slice('config/'.length);
		const entry = manifest.get(configPath);
		if (!entry) return null;
		return entry.hash !== null ? 'managed' : 'obsolete';
	}

	if (folderType === 'story') {
		const storyPrefix = filePath.split('/')[0];
		const relFromStory = filePath.slice(storyPrefix.length + 1);
		const entry = manifest.get(relFromStory);
		if (!entry) return null;
		return 'story-override';
	}

	return null;
}

async function hasFilesRecursively(dirPath: string): Promise<boolean> {
	try {
		const entries = await fs.readDir(dirPath);
		for (const entry of entries) {
			if (entry.isDirectory) {
				const childPath = dirPath ? `${dirPath}/${entry.name}` : entry.name;
				if (await hasFilesRecursively(childPath)) return true;
			} else {
				return true;
			}
		}
		return false;
	} catch {
		return true;
	}
}

export async function readDirectoryNodes(dirPath: string): Promise<FileNode[]> {
	const entries = await fs.readDir(dirPath);

	const rows = await dbStoryFolders.getAllFolderNames();
	const storyFolderNames = new Set(rows);

	const nodes: FileNode[] = [];
	for (const entry of entries) {
		const id = dirPath ? `${dirPath}/${entry.name}` : entry.name;
		let folderType = getFolderType(id);
		if (folderType === 'default') {
			const topSegment = id.split('/')[0];
			if (storyFolderNames.has(topSegment)) {
				folderType = 'story';
			}
		}

		if (entry.isDirectory && folderType === 'story' && dirPath !== '') {
			const hasFiles = await hasFilesRecursively(id);
			if (!hasFiles) continue;
		}

		let managedConfig: ManagedConfigKind | undefined;
		if (!entry.isDirectory) {
			const mc = classifyManagedConfig(id, folderType);
			if (mc !== null) managedConfig = mc;
		}
		nodes.push({ id, name: entry.name, isDirectory: entry.isDirectory, folderType, managedConfig });
	}

	nodes.sort((a, b) => {
		if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
		return a.name.localeCompare(b.name);
	});

	return nodes;
}

export async function readFileContent(path: string): Promise<string> {
	return await fs.readTextFile(path);
}

export function isBinaryData(data: Uint8Array): boolean {
	const sampleSize = Math.min(512, data.length);
	for (let i = 0; i < sampleSize; i++) {
		const byte = data[i];
		if (byte === 0) return true;
		if (byte < 9 || (byte > 13 && byte < 32) || byte === 127) return true;
	}
	return false;
}

export async function isBinaryFile(path: string): Promise<boolean> {
	const data = await fs.readBinaryFile(path);
	return isBinaryData(data);
}

export interface FileData {
	data: Uint8Array;
	isBinary: boolean;
}

export async function readFileData(path: string): Promise<FileData> {
	const data = await fs.readBinaryFile(path);
	return { data, isBinary: isBinaryData(data) };
}

export function decodeText(data: Uint8Array): string {
	return new TextDecoder().decode(data);
}

export function getLanguageFromPath(path: string): string {
	const ext = path.split('.').pop()?.toLowerCase() ?? '';
	const langMap: Record<string, string> = {
		md: 'markdown',
		markdown: 'markdown',
		json: 'json',
		jsonc: 'json',
		yaml: 'yaml',
		yml: 'yaml',
	};
	return langMap[ext] ?? '';
}

async function saveBinaryToFile(data: Uint8Array, fileName: string, mimeType?: string): Promise<void> {
	if (isTauriSync()) {
		const { save } = await import('@tauri-apps/plugin-dialog');
		const { writeFile } = await import('@tauri-apps/plugin-fs');
		const filters = mimeType === 'application/zip' ? [{ name: 'ZIP', extensions: ['zip'] }] : undefined;
		const savePath = await save({ defaultPath: fileName, filters });
		if (!savePath) return;
		await writeFile(savePath, data);
		return;
	}

	const blob = new Blob([new Uint8Array(data)], ...(mimeType ? [{ type: mimeType }] : []));
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

export async function downloadFile(path: string): Promise<void> {
	const data = await fs.readBinaryFile(path);
	const fileName = path.split('/').pop() ?? path;
	await saveBinaryToFile(data, fileName);
}

export async function saveFileContent(path: string, content: string): Promise<void> {
	await fs.writeTextFile(path, content);
}

export async function collectFilesInDir(dirPath: string): Promise<string[]> {
	const entries = await fs.readDir(dirPath);
	const files: string[] = [];
	for (const entry of entries) {
		const childPath = dirPath ? `${dirPath}/${entry.name}` : entry.name;
		if (entry.isDirectory) {
			files.push(...(await collectFilesInDir(childPath)));
		} else {
			files.push(childPath);
		}
	}
	return files;
}

export async function exportFolderAsZip(folderPath: string): Promise<void> {
	const zip = new JSZip();
	const files = await collectFilesInDir(folderPath);
	const folderName = folderPath.split('/').pop() ?? folderPath;

	for (const fp of files) {
		const content = await fs.readTextFile(fp);
		const relativePath = fp.slice(folderPath.length + 1);
		zip.file(`${folderName}/${relativePath}`, content);
	}

	const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
	await saveBinaryToFile(data, `${folderName}.zip`, 'application/zip');
}

export function isFolderTypeProtected(folderType: FolderType | undefined): boolean {
	return folderType === 'story' || folderType === 'config';
}

export async function deleteFolder(folderPath: string): Promise<void> {
	await fs.remove(folderPath);
}

export async function isConfigUserModified(configFilePath: string): Promise<boolean> {
	const configPath = configFilePath.slice('config/'.length);
	const entry = manifest.get(configPath);
	if (!entry || entry.hash === null) return true;
	const content = await fs.readTextFile(configFilePath);
	const { trimmed } = await hashContent(content);
	return trimmed !== entry.hash;
}

export interface UserChangedConfigFile {
	path: string;
	relativePath: string;
}

export async function listUserChangedConfigFiles(dirPath: string, limit = 10): Promise<UserChangedConfigFile[]> {
	if (getFolderType(dirPath) !== 'config') return [];

	const results: UserChangedConfigFile[] = [];

	async function walk(currentPath: string): Promise<void> {
		if (results.length >= limit) return;
		const entries = await fs.readDir(currentPath);
		const dirs: string[] = [];
		const files: string[] = [];
		for (const e of entries) {
			const childPath = currentPath ? `${currentPath}/${e.name}` : e.name;
			if (e.isDirectory) dirs.push(childPath);
			else files.push(childPath);
		}
		dirs.sort();
		files.sort();

		for (const filePath of files) {
			if (results.length >= limit) return;
			const configPath = filePath.slice('config/'.length);
			const entry = manifest.get(configPath);
			if (!entry || entry.hash === null) continue;
			if (await isConfigUserModified(filePath)) {
				const relativePath = filePath.slice(dirPath.length + 1);
				results.push({ path: filePath, relativePath });
			}
		}

		for (const dirPath of dirs) {
			if (results.length >= limit) return;
			await walk(dirPath);
		}
	}

	await walk(dirPath);
	return results;
}

export async function copyConfigToStory(configFilePath: string, storyFolderName: string): Promise<void> {
	const content = await fs.readTextFile(configFilePath);
	const configPath = configFilePath.slice('config/'.length);
	const destPath = `${storyFolderName}/${configPath}`;
	await fs.writeTextFileEnsuringDir(destPath, content);
}

function splitStoryPath(storyFilePath: string): { storyPrefix: string; relFromStory: string } {
	const storyPrefix = storyFilePath.split('/')[0];
	const relFromStory = storyFilePath.slice(storyPrefix.length + 1);
	return { storyPrefix, relFromStory };
}

export async function copyStoryOverrideToConfig(storyFilePath: string): Promise<void> {
	const { relFromStory } = splitStoryPath(storyFilePath);
	const destPath = `config/${relFromStory}`;
	const content = await fs.readTextFile(storyFilePath);
	await fs.writeTextFileEnsuringDir(destPath, content);
}

export async function copyStoryOverrideToStory(storyFilePath: string, destStoryFolderName: string): Promise<void> {
	const { relFromStory } = splitStoryPath(storyFilePath);
	const destPath = `${destStoryFolderName}/${relFromStory}`;
	const content = await fs.readTextFile(storyFilePath);
	await fs.writeTextFileEnsuringDir(destPath, content);
}

export async function restoreConfigDefault(configFilePath: string): Promise<void> {
	const configPath = configFilePath.slice('config/'.length);
	const content = getBundledContent(configPath);
	if (content === undefined) throw new Error('No bundled content for: ' + configPath);
	await fs.writeTextFile(configFilePath, content);
}

export async function deleteFile(filePath: string): Promise<void> {
	await fs.remove(filePath);
}
