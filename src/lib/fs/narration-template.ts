import defaultNarrationTemplate from './default-narration-template.md?raw';
import {
	readTextFile,
	writeTextFile,
	mkdir,
	exists,
	BaseDirectory
} from '@tauri-apps/plugin-fs';

export { defaultNarrationTemplate };

export const NARRATION_TEMPLATE_FILE = 'narration-template.md';

export async function loadNarrationTemplate(): Promise<string> {
	try {
		await mkdir('', { baseDir: BaseDirectory.AppData, recursive: true });

		const fileExists = await exists(NARRATION_TEMPLATE_FILE, { baseDir: BaseDirectory.AppData });
		if (!fileExists) {
			await writeTextFile(NARRATION_TEMPLATE_FILE, defaultNarrationTemplate, { baseDir: BaseDirectory.AppData });
		}

		return await readTextFile(NARRATION_TEMPLATE_FILE, { baseDir: BaseDirectory.AppData });
	} catch (err) {
		console.error('Failed to load narration template:', err);
		return defaultNarrationTemplate;
	}
}

export async function getDefaultNarrationTemplateContent(): Promise<string> {
	try {
		await mkdir('', { baseDir: BaseDirectory.AppData, recursive: true });

		const fileExists = await exists(NARRATION_TEMPLATE_FILE, { baseDir: BaseDirectory.AppData });
		if (!fileExists) {
			await writeTextFile(NARRATION_TEMPLATE_FILE, defaultNarrationTemplate, { baseDir: BaseDirectory.AppData });
		}

		return await readTextFile(NARRATION_TEMPLATE_FILE, { baseDir: BaseDirectory.AppData });
	} catch {
		return defaultNarrationTemplate;
	}
}