import { log } from '$lib/logging/logger';
import defaultActCardTemplate from './default-act-card-template.md?raw';
import defaultActExtractionPrompt from './default-act-extraction-prompt.md?raw';
import {
	readTextFile,
	writeTextFile,
	mkdir,
	exists,
	BaseDirectory
} from '@tauri-apps/plugin-fs';

export { defaultActCardTemplate, defaultActExtractionPrompt };

const ACT_CARD_TEMPLATE_FILE = 'act-card-template.md';
const ACT_EXTRACTION_PROMPT_FILE = 'act-extraction-prompt.md';

async function ensureAndLoad(fileName: string, defaultContent: string): Promise<string> {
	await mkdir('', { baseDir: BaseDirectory.AppData, recursive: true });

	const fileExists = await exists(fileName, { baseDir: BaseDirectory.AppData });
	if (!fileExists) {
		await writeTextFile(fileName, defaultContent, { baseDir: BaseDirectory.AppData });
	}

	return await readTextFile(fileName, { baseDir: BaseDirectory.AppData });
}

export async function loadActCardTemplate(): Promise<string> {
	try {
		return await ensureAndLoad(ACT_CARD_TEMPLATE_FILE, defaultActCardTemplate);
	} catch (err) {
		await log.error('prompts', 'Failed to load act card template', err);
		return defaultActCardTemplate;
	}
}

export async function loadActExtractionPrompt(): Promise<string> {
	try {
		return await ensureAndLoad(ACT_EXTRACTION_PROMPT_FILE, defaultActExtractionPrompt);
	} catch (err) {
		await log.error('prompts', 'Failed to load act extraction prompt', err);
		return defaultActExtractionPrompt;
	}
}
