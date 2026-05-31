import { fs } from '$lib/fs/file-system';
import { isTauriSync } from '$lib/runtime';
import JSZip from 'jszip';
import * as dbStoryFolders from '$lib/db/story-folders';

export type FolderType = 'story' | 'config' | 'default';

export interface FileNode {
	id: string;
	name: string;
	isDirectory: boolean;
	folderType?: FolderType;
	children?: FileNode[];
}

export function getFolderType(path: string): FolderType {
	if (path === 'config' || path.startsWith('config/')) return 'config';
	return 'default';
}

export async function readDirectoryNodes(dirPath: string): Promise<FileNode[]> {
	const entries = await fs.readDir(dirPath);

	const rows = await dbStoryFolders.getAllFolderNames();
	const storyFolderNames = new Set(rows);

	const nodes: FileNode[] = entries.map((entry) => {
		const id = dirPath ? `${dirPath}/${entry.name}` : entry.name;
		let folderType: FolderType | undefined;
		if (entry.isDirectory) {
			folderType = getFolderType(id);
			if (folderType === 'default') {
				const topSegment = id.split('/')[0];
				if (storyFolderNames.has(topSegment)) {
					folderType = 'story';
				}
			}
		}
		return { id, name: entry.name, isDirectory: entry.isDirectory, folderType };
	});

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
		const filters = mimeType === 'application/zip'
			? [{ name: 'ZIP', extensions: ['zip'] }]
			: undefined;
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
			files.push(...await collectFilesInDir(childPath));
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
