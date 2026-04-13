import { log } from '$lib/logging/logger';
import defaultCharacterCardTemplate from './default-character-card-template.md?raw';
import defaultCharacterCardExtractionPrompt from './default-character-card-extraction-prompt.md?raw';
import defaultCharacterCardExtractionSystemPrompt from './default-character-card-extraction-system-prompt.md?raw';
import defaultSummarizeCharactersInAct from './default-summarize-characters-in-act.md?raw';
import {
	readTextFile,
	writeTextFile,
	mkdir,
	exists,
	BaseDirectory
} from '@tauri-apps/plugin-fs';

export {
	defaultCharacterCardTemplate,
	defaultCharacterCardExtractionPrompt,
	defaultCharacterCardExtractionSystemPrompt,
	defaultSummarizeCharactersInAct
};

const CHARACTER_CARD_TEMPLATE_FILE = 'character-card-template.md';
const CHARACTER_CARD_EXTRACTION_PROMPT_FILE = 'character-card-extraction-prompt.md';
const CHARACTER_CARD_EXTRACTION_SYSTEM_PROMPT_FILE = 'character-card-extraction-system-prompt.md';
const SUMMARIZE_CHARACTERS_IN_ACT_FILE = 'summarize-characters-in-act.md';

async function ensureAndLoad(fileName: string, defaultContent: string): Promise<string> {
	await mkdir('', { baseDir: BaseDirectory.AppData, recursive: true });

	const fileExists = await exists(fileName, { baseDir: BaseDirectory.AppData });
	if (!fileExists) {
		await writeTextFile(fileName, defaultContent, { baseDir: BaseDirectory.AppData });
	}

	return await readTextFile(fileName, { baseDir: BaseDirectory.AppData });
}

export async function loadCharacterCardTemplate(): Promise<string> {
	try {
		return await ensureAndLoad(CHARACTER_CARD_TEMPLATE_FILE, defaultCharacterCardTemplate);
	} catch (err) {
		await log.error('prompts', 'Failed to load character card template', err);
		return defaultCharacterCardTemplate;
	}
}

export async function loadCharacterCardExtractionPrompt(): Promise<string> {
	try {
		return await ensureAndLoad(CHARACTER_CARD_EXTRACTION_PROMPT_FILE, defaultCharacterCardExtractionPrompt);
	} catch (err) {
		await log.error('prompts', 'Failed to load character card extraction prompt', err);
		return defaultCharacterCardExtractionPrompt;
	}
}

export async function loadCharacterCardExtractionSystemPrompt(): Promise<string> {
	try {
		return await ensureAndLoad(CHARACTER_CARD_EXTRACTION_SYSTEM_PROMPT_FILE, defaultCharacterCardExtractionSystemPrompt);
	} catch (err) {
		await log.error('prompts', 'Failed to load character card extraction system prompt', err);
		return defaultCharacterCardExtractionSystemPrompt;
	}
}

export async function loadSummarizeCharactersInAct(): Promise<string> {
	try {
		return await ensureAndLoad(SUMMARIZE_CHARACTERS_IN_ACT_FILE, defaultSummarizeCharactersInAct);
	} catch (err) {
		await log.error('prompts', 'Failed to load summarize characters in act prompt', err);
		return defaultSummarizeCharactersInAct;
	}
}