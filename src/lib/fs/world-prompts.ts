import { log } from '$lib/logging/logger';
import defaultWorldTemplate from './default-world-template.md?raw';
import defaultGenerateWorldFromChatPrompt from './default-generate-world-from-chat-prompt.md?raw';
import defaultGenerateWorldFromChatSystemPrompt from './default-generate-world-from-chat-system-prompt.md?raw';
import defaultWorldBuilderSystemPrompt from './default-world-builder-system-prompt.md?raw';
import {
	readTextFile,
	writeTextFile,
	mkdir,
	exists,
	BaseDirectory
} from '@tauri-apps/plugin-fs';

export { defaultWorldTemplate, defaultGenerateWorldFromChatPrompt, defaultGenerateWorldFromChatSystemPrompt, defaultWorldBuilderSystemPrompt };

const WORLD_TEMPLATE_FILE = 'world-template.md';
const GENERATE_WORLD_FROM_CHAT_FILE = 'generate-world-from-chat-prompt.md';
const GENERATE_WORLD_FROM_CHAT_SYSTEM_FILE = 'generate-world-from-chat-system-prompt.md';
const WORLD_BUILDER_SYSTEM_FILE = 'world-builder-system-prompt.md';

export { WORLD_TEMPLATE_FILE, GENERATE_WORLD_FROM_CHAT_FILE, GENERATE_WORLD_FROM_CHAT_SYSTEM_FILE, WORLD_BUILDER_SYSTEM_FILE };

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
		log.error('prompts', 'Failed to load world template', err);
		return defaultWorldTemplate;
	}
}

export async function loadGenerateWorldFromChatPrompt(): Promise<string> {
	try {
		return await ensureAndLoad(GENERATE_WORLD_FROM_CHAT_FILE, defaultGenerateWorldFromChatPrompt);
	} catch (err) {
		log.error('prompts', 'Failed to load generate world from chat prompt', err);
		return defaultGenerateWorldFromChatPrompt;
	}
}

export async function loadGenerateWorldFromChatSystemPrompt(): Promise<string> {
	try {
		return await ensureAndLoad(GENERATE_WORLD_FROM_CHAT_SYSTEM_FILE, defaultGenerateWorldFromChatSystemPrompt);
	} catch (err) {
		log.error('prompts', 'Failed to load generate world from chat system prompt', err);
		return defaultGenerateWorldFromChatSystemPrompt;
	}
}

export async function loadWorldBuilderSystemPrompt(): Promise<string> {
	try {
		return await ensureAndLoad(WORLD_BUILDER_SYSTEM_FILE, defaultWorldBuilderSystemPrompt);
	} catch (err) {
		log.error('prompts', 'Failed to load world builder system prompt', err);
		return defaultWorldBuilderSystemPrompt;
	}
}
