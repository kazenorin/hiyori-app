import {
	readTextFile,
	writeTextFile,
	mkdir,
	exists,
	BaseDirectory
} from '@tauri-apps/plugin-fs';

const FILE_NAME = 'test.md';
const DEFAULT_CONTENT = '# Test file';

export async function loadChatFile(): Promise<string> {
	try {
		await mkdir('', { baseDir: BaseDirectory.AppData, recursive: true });

		const fileExists = await exists(FILE_NAME, { baseDir: BaseDirectory.AppData });
		if (!fileExists) {
			await writeTextFile(FILE_NAME, DEFAULT_CONTENT, { baseDir: BaseDirectory.AppData });
		}

		return await readTextFile(FILE_NAME, { baseDir: BaseDirectory.AppData });
	} catch (err) {
		console.error('Failed to load chat file:', err);
		return '';
	}
}
