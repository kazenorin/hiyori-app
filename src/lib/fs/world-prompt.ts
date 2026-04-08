import defaultWorldTemplatePrompt from './default-world-template-prompt.md?raw';
import {
	readTextFile,
	writeTextFile,
	mkdir,
	exists,
	BaseDirectory
} from '@tauri-apps/plugin-fs';

export { defaultWorldTemplatePrompt };

const WORLD_TEMPLATE_FILE = 'world-template-prompt.md';

export { WORLD_TEMPLATE_FILE };

export async function loadWorldTemplatePrompt(): Promise<string> {
	try {
		await mkdir('', { baseDir: BaseDirectory.AppData, recursive: true });

		const fileExists = await exists(WORLD_TEMPLATE_FILE, { baseDir: BaseDirectory.AppData });
		if (!fileExists) {
			await writeTextFile(WORLD_TEMPLATE_FILE, defaultWorldTemplatePrompt, {
				baseDir: BaseDirectory.AppData
			});
		}

		return await readTextFile(WORLD_TEMPLATE_FILE, { baseDir: BaseDirectory.AppData });
	} catch (err) {
		console.error('Failed to load world template prompt:', err);
		return defaultWorldTemplatePrompt;
	}
}
