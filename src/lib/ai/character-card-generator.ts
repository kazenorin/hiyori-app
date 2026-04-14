import {generateText, type ModelMessage} from 'ai';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { createModel } from './provider';
import {
	loadCharacterCardTemplate,
	loadCharacterCardExtractionPrompt,
	loadCharacterCardExtractionSystemPrompt,
	loadSummarizeCharactersInAct
} from '$lib/fs/character-card-prompts';
import { loadSystemPrompt } from '$lib/fs/system-prompt';
import { exportActLine } from './act-line-export';
import { getMessagesForLine, getActLine } from '$lib/db/act-lines';
import { getAct } from '$lib/db/acts';
import { resolveStoryFolder } from '$lib/fs/story-prompts';
import {
	getActiveStoryId,
	getActiveActId,
	getActiveActLineId,
	getActiveStory
} from '$lib/stores/stories.svelte';
import { mkdir, writeTextFile, readTextFile, exists, BaseDirectory } from '@tauri-apps/plugin-fs';
import { toKebabCase } from '$lib/utils/string';
import { log } from '$lib/logging/logger';
import { logCharacterCardActivity } from '$lib/logging/chat-logger';
import { buildLineDir } from './card-output-path';

// === Act Card Loading ===

async function loadActCard(
	storyFolder: string,
	actNumber: number,
	isMainLine: boolean,
	actLineId: string
): Promise<string | null> {
	const lineDir = buildLineDir(storyFolder, actNumber, isMainLine, actLineId);
	const path = `${lineDir}/act-card.md`;

	try {
		const fileExists = await exists(path, { baseDir: BaseDirectory.AppData });
		if (!fileExists) return null;
		return await readTextFile(path, { baseDir: BaseDirectory.AppData });
	} catch {
		return null;
	}
}

// === Types ===

export interface CharacterSummary {
	character: string;
	importance: string;
}

export interface CharacterEntry {
	character: string;
	importance: string;
	canonicalName: string;
	include: boolean;
	isManual: boolean;
}

export interface ActLineageEntry {
	actNumber: number;
	actLineId: string;
	isMainLine: boolean;
}

export interface CharacterCardResult {
	characterName: string;
	filePath: string;
	content: string;
}

export interface GenerateProgress {
	completed: number;
	total: number;
	currentCharacter: string;
}

// === Character Entry Helpers ===

export function toCharacterEntries(summaries: CharacterSummary[]): CharacterEntry[] {
	return summaries.map((s) => ({
		character: s.character,
		importance: s.importance,
		canonicalName: toKebabCase(s.character),
		include: true,
		isManual: false
	}));
}

// === Extraction ===

export async function extractCharactersFromActLine(): Promise<CharacterSummary[]> {
	const actLineId = getActiveActLineId();
	if (!actLineId) throw new Error('No active act line selected.');

	const config = getMainProviderConfig();
	if (!config?.apiKey) throw new Error('No main provider configured.');

	const allMessages = await getMessagesForLine(actLineId);
	const transcript: string[] = exportActLine(allMessages);
	if (transcript.length === 0) throw new Error('No narrative content found in this act line.');

	const summarizePrompt = await loadSummarizeCharactersInAct();
	const systemPrompt = await loadSystemPrompt();

	const model = createModel(config);

	await logCharacterCardActivity('extraction-start', `Extracting characters from act line: ${actLineId}\n
  System Prompt:\n${systemPrompt}\n
  Transcript:\n    ${transcript.join('\n    ')}`);

	const messages: ModelMessage[] = [
		{ role: 'user', content: 'I need your help to extract all the characters from the current act.\nThe following messages will contain the transcript of the current act:' },
		...(transcript.map(toUserModelMessage)),
		{ role: 'user', content: 'The previous message was the end of the transcript of the current act.' },
		{ role: 'user', content: `Extract all the characters from the current act according to the following rules: ${summarizePrompt}` }
	];
	const result = await generateText({model, system: systemPrompt, messages});

	await logCharacterCardActivity('extraction-end', `
  Result: ${result.text}
  Usage: ${JSON.stringify(result.usage, null, 4)}
  Finish Reason: ${result.finishReason}`);

	const parsed = parseCharacterJson(result.text);
	return parsed;
}

function parseCharacterJson(text: string): CharacterSummary[] {
	// Try to extract JSON from the response
	let jsonStr = text.trim();

	// Strip markdown code fences if present
	const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fenceMatch) {
		jsonStr = fenceMatch[1].trim();
	}

	try {
		const parsed = JSON.parse(jsonStr);
		if (!Array.isArray(parsed)) throw new Error('Not an array');

		return parsed
			.filter((item: unknown) => {
				if (typeof item !== 'object' || item === null) return false;
				const obj = item as Record<string, unknown>;
				return typeof obj.character === 'string' && typeof obj.importance === 'string';
			})
			.map((item: Record<string, unknown>) => ({
				character: item.character as string,
				importance: item.importance as string
			}));
	} catch {
		throw new Error(`PARSE_FAILED:${text}`);
	}
}

export { parseCharacterJson as _parseCharacterJsonForTest };

// === Lineage ===

export async function buildActLineage(): Promise<ActLineageEntry[]> {
	const actId = getActiveActId();
	const actLineId = getActiveActLineId();
	if (!actId || !actLineId) throw new Error('No active act line selected.');

	const lineage: ActLineageEntry[] = [];
	const visited = new Set<string>();

	// Start with the current act
	let currentActId: string | null = actId;
	let currentActLineId: string | null = actLineId;

	while (currentActId && currentActLineId) {
		if (visited.has(currentActId)) break;
		visited.add(currentActId);

		const act = await getAct(currentActId);
		if (!act) break;

		const actLine = await getActLine(currentActLineId);
		lineage.push({
			actNumber: act.actNumber,
			actLineId: currentActLineId,
			isMainLine: actLine?.isMainLine ?? false
		});

		// Follow the chain to the previous act
		if (!act.continuesFromActLineId) break;

		// The continuesFromActLineId points to a line in the previous act.
		// We need to find which act contains that line.
		const prevActLineId = act.continuesFromActLineId;
		const prevActLine = await getActLine(prevActLineId);
		if (!prevActLine) break;

		currentActId = prevActLine.actId;
		currentActLineId = prevActLineId;
	}

	// Sort descending by act number (newest first)
	lineage.sort((a, b) => b.actNumber - a.actNumber);
	return lineage;
}

// === Existing Character Card Loading ===

function computeCardFilename(canonicalName: string): string {
	return `${canonicalName}.md`;
}

export { computeCardFilename as _computeCardFilenameForTest };

async function loadExistingCharacterCard(
	storyFolder: string,
	actNumber: number,
	canonicalName: string,
	isMainLine: boolean,
	actLineId: string
): Promise<string | null> {
	const lineDir = buildLineDir(storyFolder, actNumber, isMainLine, actLineId);
	const charactersDir = `${lineDir}/characters`;
	const filename = computeCardFilename(canonicalName);
	const path = `${charactersDir}/${filename}`;

	try {
		const fileExists = await exists(path, { baseDir: BaseDirectory.AppData });
		if (!fileExists) return null;
		return await readTextFile(path, { baseDir: BaseDirectory.AppData });
	} catch {
		return null;
	}
}

// === Card Generation ===

export async function generateCharacterCard(
	entry: CharacterEntry,
	lineage: ActLineageEntry[],
	onProgress?: (progress: GenerateProgress) => void,
	progress?: GenerateProgress
): Promise<CharacterCardResult> {
	const storyId = getActiveStoryId();
	const story = getActiveStory();
	const actId = getActiveActId();

	if (!storyId || !story || !actId) throw new Error('No active story context.');

	const config = getMainProviderConfig();
	if (!config?.apiKey) throw new Error('No main provider configured.');

	// Load prompts
	const template = await loadCharacterCardTemplate();
	const extractionPrompt = await loadCharacterCardExtractionPrompt();
	const extractionSystemPrompt = await loadCharacterCardExtractionSystemPrompt();
	const systemPrompt = await loadSystemPrompt();

	// Build system prompt: main chat system prompt + extraction system prompt
	const combinedSystem = `${systemPrompt}\n\n---\n\n${extractionSystemPrompt}`;

	// Inject character name into prompts
	const namedExtractionPrompt = extractionPrompt.replaceAll('{{character name}}', entry.character);
	const namedTemplate = template.replaceAll('{{character name}}', entry.character);

	// Load current act transcript
	const actLineId = getActiveActLineId()!;
	const allMessages = await getMessagesForLine(actLineId);
	const transcript = exportActLine(allMessages);

	// Build user prompt with act cards from previous acts
	const storyFolder = await resolveStoryFolder(storyId, story.name);
	const currentAct = await getAct(actId);
	const currentActNumber = currentAct?.actNumber ?? 0;
	const previousActCardsSection: string[] = [];

	for (const lineageEntry of lineage) {
		// Skip current act — its transcript is already included above
		if (lineageEntry.actNumber === currentActNumber) continue;

		const actCard = await loadActCard(
			storyFolder,
			lineageEntry.actNumber,
			lineageEntry.isMainLine,
			lineageEntry.actLineId
		);
		if (actCard) {
			previousActCardsSection.push(`The following message contains the Act Card from Act ${lineageEntry.actNumber}`);
			previousActCardsSection.push(actCard);
		}
	}

	// Load existing character cards from lineage
	const existingCardsSection: string[] = [];
	for (const lineageEntry of lineage) {
		const card = await loadExistingCharacterCard(
			storyFolder,
			lineageEntry.actNumber,
			entry.canonicalName,
			lineageEntry.isMainLine,
			lineageEntry.actLineId
		);
		if (card) {
			existingCardsSection.push(`The following message contains the previous Character Card of ${entry.character} from Act ${lineageEntry.actNumber}`);
			existingCardsSection.push(card);
		}
	}

	const userPrompt = `Based on the information from the chat history, generate a new Character Card according to the following rules:
${namedExtractionPrompt}\n---\n${namedTemplate}`;

	if (onProgress && progress) {
		onProgress(progress);
	}

	// Generate
	const model = createModel(config);

	const messages: ModelMessage[] = [
		{ role: 'user', content: 'The following messages will contain the transcript of the current act:' },
		...(transcript.map(toUserModelMessage)),
		{ role: 'user', content: 'The previous message was the end of the transcript of the current act.' },
		...(previousActCardsSection.map(toUserModelMessage)),
		...(existingCardsSection.map(toUserModelMessage)),
		{ role: 'user', content: userPrompt }
	];

	await logCharacterCardActivity('generation-start', `Character: ${entry.character}\n\nMessages:\n${JSON.stringify(messages, null, 2)}`);

	const result = await generateText({model, system: combinedSystem, messages});

	await logCharacterCardActivity('generation-end', `
  Character: ${entry.character}
  Result: ${result.text}
  Usage: ${JSON.stringify(result.usage, null, 4)}
  Finish Reason: ${result.finishReason}`);

	// Get current act info for saving (reusing currentAct fetched earlier)
	if (!currentAct) throw new Error('Active act not found.');

	const actLine = await getActLine(getActiveActLineId()!);
	const isMainLine = actLine?.isMainLine ?? false;

	// Save file
	const lineDir = buildLineDir(storyFolder, currentAct.actNumber, isMainLine, getActiveActLineId()!);
	const charactersDir = `${lineDir}/characters`;
	const filename = computeCardFilename(entry.canonicalName);
	const filePath = `${charactersDir}/${filename}`;

	await mkdir(charactersDir, { baseDir: BaseDirectory.AppData, recursive: true });
	await writeTextFile(filePath, result.text, { baseDir: BaseDirectory.AppData });

	return {
		characterName: entry.character,
		filePath,
		content: result.text
	};
}

export async function generateCharacterCards(
	entries: CharacterEntry[],
	concurrent: boolean,
	onProgress?: (progress: GenerateProgress) => void
): Promise<CharacterCardResult[]> {
	const lineage = await buildActLineage();
	const selected = entries.filter((e) => {
		if (e.isManual) return e.character.trim().length > 0;
		return e.include;
	});

	if (selected.length === 0) throw new Error('No characters selected for generation.');

	const results: CharacterCardResult[] = [];

	if (concurrent) {
		const promises = selected.map((entry, i) =>
			generateCharacterCard(entry, lineage, onProgress, {
				completed: i,
				total: selected.length,
				currentCharacter: entry.character
			})
		);
		const settled = await Promise.allSettled(promises);

		for (let i = 0; i < settled.length; i++) {
			const result = settled[i];
			if (result.status === 'fulfilled') {
				results.push(result.value);
			} else {
				await log.error(
					'character-card',
					`Failed to generate card for ${selected[i].character}`,
					result.reason
				);
			}
		}
	} else {
		for (let i = 0; i < selected.length; i++) {
			const entry = selected[i];
			const progress: GenerateProgress = {
				completed: i,
				total: selected.length,
				currentCharacter: entry.character
			};

			try {
				const result = await generateCharacterCard(entry, lineage, onProgress, progress);
				results.push(result);
			} catch (err) {
				await log.error(
					'character-card',
					`Failed to generate card for ${entry.character}`,
					err
				);
			}
		}
	}

	return results;
}

function toUserModelMessage(content: string): ModelMessage {
	return {role: 'user', content};
}
