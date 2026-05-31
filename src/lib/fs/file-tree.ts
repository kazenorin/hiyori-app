import { fs } from '$lib/fs/file-system';
import { isTauriSync } from '$lib/runtime';

export interface FileNode {
	id: string;
	name: string;
	isDirectory: boolean;
	children?: FileNode[];
}

export async function readDirectoryNodes(dirPath: string): Promise<FileNode[]> {
	const entries = await fs.readDir(dirPath);

	const nodes: FileNode[] = entries.map((entry) => ({
		id: dirPath ? `${dirPath}/${entry.name}` : entry.name,
		name: entry.name,
		isDirectory: entry.isDirectory,
	}));

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

export async function downloadFile(path: string): Promise<void> {
	const data = await fs.readBinaryFile(path);
	const fileName = path.split('/').pop() ?? path;

	if (isTauriSync()) {
		const { save } = await import('@tauri-apps/plugin-dialog');
		const { writeFile } = await import('@tauri-apps/plugin-fs');
		const filePath = await save({ defaultPath: fileName });
		if (!filePath) return;
		await writeFile(filePath, data);
		return;
	}

	const blob = new Blob([new Uint8Array(data)]);
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
