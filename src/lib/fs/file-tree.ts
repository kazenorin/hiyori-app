import { fs } from '$lib/fs/file-system';

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
