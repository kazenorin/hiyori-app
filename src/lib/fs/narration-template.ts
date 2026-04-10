import { log } from '$lib/logging/logger';
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

async function ensureAndLoad(fileName: string, defaultContent: string): Promise<string> {
	await mkdir('', { baseDir: BaseDirectory.AppData, recursive: true });

	const fileExists = await exists(fileName, { baseDir: BaseDirectory.AppData });
	if (!fileExists) {
		await writeTextFile(fileName, defaultContent, { baseDir: BaseDirectory.AppData });
	}

	return await readTextFile(fileName, { baseDir: BaseDirectory.AppData });
}

export async function loadNarrationTemplate(): Promise<string> {
	try {
		return await ensureAndLoad(NARRATION_TEMPLATE_FILE, defaultNarrationTemplate);
	} catch (err) {
		await log.error('narration', 'Failed to load narration template', err);
		return defaultNarrationTemplate;
	}
}

export async function getDefaultNarrationTemplateContent(): Promise<string> {
	try {
		return await ensureAndLoad(NARRATION_TEMPLATE_FILE, defaultNarrationTemplate);
	} catch {
		return defaultNarrationTemplate;
	}
}
