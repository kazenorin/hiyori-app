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

export async function loadSystemPrompt(): Promise<string> {
	try {
		await mkdir('', { baseDir: BaseDirectory.AppData, recursive: true });

		const fileExists = await exists(SYSTEM_PROMPT_FILE, { baseDir: BaseDirectory.AppData });
		if (!fileExists) {
			await writeTextFile(SYSTEM_PROMPT_FILE, defaultSystemPrompt, { baseDir: BaseDirectory.AppData });
		}

		return await readTextFile(SYSTEM_PROMPT_FILE, { baseDir: BaseDirectory.AppData });
	} catch (err) {
		log.error('system-prompt', 'Failed to load system prompt', err);
		return defaultSystemPrompt;
	}
}

export async function getDefaultSystemPromptContent(): Promise<string> {
	try {
		await mkdir('', { baseDir: BaseDirectory.AppData, recursive: true });

		const fileExists = await exists(SYSTEM_PROMPT_FILE, { baseDir: BaseDirectory.AppData });
		if (!fileExists) {
			await writeTextFile(SYSTEM_PROMPT_FILE, defaultSystemPrompt, { baseDir: BaseDirectory.AppData });
		}

		return await readTextFile(SYSTEM_PROMPT_FILE, { baseDir: BaseDirectory.AppData });
	} catch {
		return defaultSystemPrompt;
	}
}
