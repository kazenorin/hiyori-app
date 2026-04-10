import { log } from '$lib/logging/logger';
import defaultSystemPrompt from './default-system-prompt.md?raw';
import {
	readTextFile,
	writeTextFile,
	mkdir,
	exists,
	BaseDirectory
} from '@tauri-apps/plugin-fs';

export { defaultSystemPrompt };

const SYSTEM_PROMPT_FILE = 'system-prompt.md';

export { SYSTEM_PROMPT_FILE };

async function ensureAndLoad(fileName: string, defaultContent: string): Promise<string> {
	await mkdir('', { baseDir: BaseDirectory.AppData, recursive: true });

	const fileExists = await exists(fileName, { baseDir: BaseDirectory.AppData });
	if (!fileExists) {
		await writeTextFile(fileName, defaultContent, { baseDir: BaseDirectory.AppData });
	}

	return await readTextFile(fileName, { baseDir: BaseDirectory.AppData });
}

export async function loadSystemPrompt(): Promise<string> {
	try {
		return await ensureAndLoad(SYSTEM_PROMPT_FILE, defaultSystemPrompt);
	} catch (err) {
		await log.error('system-prompt', 'Failed to load system prompt', err);
		return defaultSystemPrompt;
	}
}

export async function getDefaultSystemPromptContent(): Promise<string> {
	try {
		return await ensureAndLoad(SYSTEM_PROMPT_FILE, defaultSystemPrompt);
	} catch {
		return defaultSystemPrompt;
	}
}
