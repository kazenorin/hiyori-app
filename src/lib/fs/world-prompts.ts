import defaultWorldTemplate from './default-world-template.md?raw';
import defaultGenerateWorldFromChatPrompt from './default-generate-world-from-chat-prompt.md?raw';
import {
	readTextFile,
	writeTextFile,
	mkdir,
	exists,
	BaseDirectory
} from '@tauri-apps/plugin-fs';

export { defaultWorldTemplate, defaultGenerateWorldFromChatPrompt };

const WORLD_TEMPLATE_FILE = 'world-template.md';
const GENERATE_WORLD_FROM_CHAT_FILE = 'generate-world-from-chat-prompt.md';

export { WORLD_TEMPLATE_FILE, GENERATE_WORLD_FROM_CHAT_FILE };

async function ensureAndLoad(fileName: string, defaultContent: string): Promise<string> {
	await mkdir('', { baseDir: BaseDirectory.AppData, recursive: true });

	const fileExists = await exists(fileName, { baseDir: BaseDirectory.AppData });
	if (!fileExists) {
		await writeTextFile(fileName, defaultContent, { baseDir: BaseDirectory.AppData });
	}

	return await readTextFile(fileName, { baseDir: BaseDirectory.AppData });
}

export async function loadWorldTemplate(): Promise<string> {
	try {
		return await ensureAndLoad(WORLD_TEMPLATE_FILE, defaultWorldTemplate);
	} catch (err) {
		console.error('Failed to load world template:', err);
		return defaultWorldTemplate;
	}
}

export async function loadGenerateWorldFromChatPrompt(): Promise<string> {
	try {
		return await ensureAndLoad(GENERATE_WORLD_FROM_CHAT_FILE, defaultGenerateWorldFromChatPrompt);
	} catch (err) {
		console.error('Failed to load generate world from chat prompt:', err);
		return defaultGenerateWorldFromChatPrompt;
	}
}
