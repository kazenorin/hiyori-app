import defaultSystemPrompt from './default-system-prompt.md?raw';
import {
	readTextFile,
	writeTextFile,
	mkdir,
	exists,
	BaseDirectory
} from '@tauri-apps/plugin-fs';

const FILE_NAME = 'system-prompt.md';

export async function loadSystemPrompt(): Promise<string> {
	try {
		await mkdir('', { baseDir: BaseDirectory.AppData, recursive: true });

		const fileExists = await exists(FILE_NAME, { baseDir: BaseDirectory.AppData });
		if (!fileExists) {
			await writeTextFile(FILE_NAME, defaultSystemPrompt, { baseDir: BaseDirectory.AppData });
		}

		return await readTextFile(FILE_NAME, { baseDir: BaseDirectory.AppData });
	} catch (err) {
		console.error('Failed to load system prompt:', err);
		return defaultSystemPrompt;
	}
}