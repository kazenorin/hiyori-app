import { generateText, type ModelMessage } from 'ai';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { createModel } from './provider';
import {
	loadCharacterCardTemplate,
	loadCharacterCardExtractionPrompt,
	loadCharacterCardExtractionSystemPrompt,
	loadSummarizeCharactersInAct,
	loadSystemPrompt,
} from '$lib/fs/prompts';
import { exportActLine } from './act-line-export';
import { getMessagesForLine, getActLine } from '$lib/db/act-lines';
import { getAct } from '$lib/db/acts';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { getActiveStoryId, getActiveActId, getActiveActLineId, getActiveStory } from '$lib/stores/stories.svelte';
import { mkdir, writeTextFile, readTextFile, exists, BaseDirectory } from '@tauri-apps/plugin-fs';
import { toKebabCase } from '$lib/utils/string';
import { log } from '$lib/logging/logger';
import { logCharacterCardActivity } from '$lib/logging/chat-logger';
import { buildLineDir } from './card-output-path';

// === Types ===

const ERR_NO_CONTEXT = 'No active story context.';

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
		isManual: false,
	}));
}

// === Extraction ===

export async function extractCharactersFromActLine(): Promise<CharacterSummary[]> {
	const actLineId = getActiveActLineId();
	if (!actLineId) throw new Error(ERR_NO_CONTEXT);

	const config = getMainProviderConfig();
	if (!config?.apiKey) throw new Error('No main provider configured.');

	const allMessages = await getMessagesForLine(actLineId);
	const transcript: string[] = exportActLine(allMessages);
	if (transcript.length === 0) throw new Error('No narrative content found in this act line.');

	const summarizePrompt = await loadSummarizeCharactersInAct();
	const systemPrompt = await loadSystemPrompt();

	const model = createModel(config);

	await logCharacterCardActivity(
		'extraction-start',
		`Extracting characters from act line: ${actLineId}\n
  System Prompt:\n${systemPrompt}\n
  Transcript:\n    ${transcript.join('\n    ')}`
	);

	const messages: ModelMessage[] = [
		{
			role: 'user',
			content:
				'I need your help to extract all the characters from the current act.\nThe following messages will contain the transcript of the current act:',
		},
		...transcript.map(toUserModelMessage),
		{ role: 'user', content: 'The previous message was the end of the transcript of the current act.' },
		{
			role: 'user',
			content: `Extract all the characters from the current act according to the following rules: ${summarizePrompt}`,
		},
	];
	const result = await generateText({ model, system: systemPrompt, messages });

	await logCharacterCardActivity(
		'extraction-end',
		`
  Result: ${result.text}
  Usage: ${JSON.stringify(result.usage, null, 4)}
  Finish Reason: ${result.finishReason}`
	);

	const parsed = parseCharacterJson(result.text);
	return parsed;
}

function parseCharacterJson(text: string): CharacterSummary[] {
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
				importance: item.importance as string,
			}));
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`PARSE_FAILED:${msg}\n${text}`);
	}
}

export { parseCharacterJson as _parseCharacterJsonForTest };

// === Lineage ===

/**
 * Walk the act chain backwards from the current act line via `continuesFromActLineId`.
 * Returns entries sorted newest-first. A `visited` set prevents infinite loops
 * if the chain is somehow circular.
 */
export async function buildActLineage(): Promise<ActLineageEntry[]> {
	const actId = getActiveActId();
	const actLineId = getActiveActLineId();
	if (!actId || !actLineId) throw new Error(ERR_NO_CONTEXT);

	const lineage: ActLineageEntry[] = [];
	const visited = new Set<string>();

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
			isMainLine: actLine?.isMainLine ?? false,
		});

		if (!act.continuesFromActLineId) break;

		const prevActLineId = act.continuesFromActLineId;
		const prevActLine = await getActLine(prevActLineId);
		if (!prevActLine) break;

		currentActId = prevActLine.actId;
		currentActLineId = prevActLineId;
	}

	lineage.sort((a, b) => b.actNumber - a.actNumber);
	return lineage;
}

// === File I/O Helpers ===

function computeCardFilename(canonicalName: string): string {
	return `${canonicalName}.md`;
}

export { computeCardFilename as _computeCardFilenameForTest };

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
	} catch (err) {
		await log.warn('character-card', `Failed to read act card at ${path}: ${err}`);
		return null;
	}
}

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
	} catch (err) {
		await log.warn('character-card', `Failed to read character card at ${path}: ${err}`);
		return null;
	}
}

// === Context Building ===

async function loadPreviousActCards(
	storyFolder: string,
	lineage: ActLineageEntry[],
	skipActNumber: number
): Promise<string[]> {
	const sections: string[] = [];
	for (const entry of lineage) {
		if (entry.actNumber === skipActNumber) continue;

		const actCard = await loadActCard(storyFolder, entry.actNumber, entry.isMainLine, entry.actLineId);
		if (actCard) {
			sections.push(`The following message contains the Act Card from Act ${entry.actNumber}`);
			sections.push(actCard);
		}
	}
	return sections;
}

async function loadPreviousCharacterCards(
	storyFolder: string,
	lineage: ActLineageEntry[],
	canonicalName: string,
	characterName: string
): Promise<string[]> {
	const sections: string[] = [];
	for (const entry of lineage) {
		const card = await loadExistingCharacterCard(
			storyFolder,
			entry.actNumber,
			canonicalName,
			entry.isMainLine,
			entry.actLineId
		);
		if (card) {
			sections.push(
				`The following message contains the previous Character Card of ${characterName} from Act ${entry.actNumber}`
			);
			sections.push(card);
		}
	}
	return sections;
}

function buildGenerationMessages(
	transcript: string[],
	previousActCards: string[],
	existingCards: string[],
	userPrompt: string
): ModelMessage[] {
	return [
		{ role: 'user', content: 'The following messages will contain the transcript of the current act:' },
		...transcript.map(toUserModelMessage),
		{ role: 'user', content: 'The previous message was the end of the transcript of the current act.' },
		...previousActCards.map(toUserModelMessage),
		...existingCards.map(toUserModelMessage),
		{ role: 'user', content: userPrompt },
	];
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
	const actLineId = getActiveActLineId();

	if (!storyId || !story || !actId || !actLineId) {
		throw new Error(ERR_NO_CONTEXT);
	}

	const config = getMainProviderConfig();
	if (!config?.apiKey) throw new Error('No main provider configured.');

	if (!entry.canonicalName.trim()) {
		throw new Error(`Character name resolves to empty identifier: "${entry.character}"`);
	}

	if (onProgress && progress) {
		onProgress(progress);
	}

	// Load prompts
	const [template, extractionPrompt, extractionSystemPrompt, systemPrompt] = await Promise.all([
		loadCharacterCardTemplate(),
		loadCharacterCardExtractionPrompt(),
		loadCharacterCardExtractionSystemPrompt(),
		loadSystemPrompt(),
	]);

	const combinedSystem = `${systemPrompt}\n\n---\n\n${extractionSystemPrompt}`;
	const namedExtractionPrompt = extractionPrompt.replaceAll('{{character name}}', entry.character);
	const namedTemplate = template.replaceAll('{{character name}}', entry.character);

	// Load transcript and context
	const allMessages = await getMessagesForLine(actLineId);
	const transcript = exportActLine(allMessages);

	const storyFolder = await resolveStoryFolder(storyId, story.name);
	const currentAct = await getAct(actId);
	if (!currentAct) throw new Error(ERR_NO_CONTEXT);

	const currentActNumber = currentAct.actNumber;

	// Use lineage entry for isMainLine to avoid redundant DB query
	const currentLineageEntry = lineage.find((l) => l.actLineId === actLineId);
	const isMainLine = currentLineageEntry?.isMainLine ?? false;

	const [previousActCards, existingCards] = await Promise.all([
		loadPreviousActCards(storyFolder, lineage, currentActNumber),
		loadPreviousCharacterCards(storyFolder, lineage, entry.canonicalName, entry.character),
	]);

	const userPrompt = `Based on the information from the chat history, generate a new Character Card according to the following rules:\n${namedExtractionPrompt}\n---\n${namedTemplate}`;
	const messages = buildGenerationMessages(transcript, previousActCards, existingCards, userPrompt);

	const model = createModel(config);

	await logCharacterCardActivity(
		'generation-start',
		`Character: ${entry.character}\n\nMessages:\n${JSON.stringify(messages, null, 2)}`
	);

	const result = await generateText({ model, system: combinedSystem, messages });

	await logCharacterCardActivity(
		'generation-end',
		`
  Character: ${entry.character}
  Result: ${result.text}
  Usage: ${JSON.stringify(result.usage, null, 4)}
  Finish Reason: ${result.finishReason}`
	);

	// Save file
	const lineDir = buildLineDir(storyFolder, currentAct.actNumber, isMainLine, actLineId);
	const charactersDir = `${lineDir}/characters`;
	const filename = computeCardFilename(entry.canonicalName);
	const filePath = `${charactersDir}/${filename}`;

	await mkdir(charactersDir, { baseDir: BaseDirectory.AppData, recursive: true });
	await writeTextFile(filePath, result.text, { baseDir: BaseDirectory.AppData });

	return {
		characterName: entry.character,
		filePath,
		content: result.text,
	};
}

export async function generateCharacterCards(
	entries: CharacterEntry[],
	parallel: boolean,
	onProgress?: (progress: GenerateProgress) => void
): Promise<CharacterCardResult[]> {
	// Separate valid entries from skipped ones
	const { selected, skipped } = validateEntries(entries);

	if (skipped.length > 0) {
		await log.warn(
			'character-card',
			`Skipped ${skipped.length} entries with empty names: ${skipped.map((e) => `"${e.character}"`).join(', ')}`
		);
	}

	if (selected.length === 0) throw new Error('No characters selected for generation.');

	const lineage = await buildActLineage();

	const results: CharacterCardResult[] = [];

	if (parallel) {
		const promises = selected.map((entry) => generateCharacterCard(entry, lineage));
		const settled = await Promise.allSettled(promises);

		for (let i = 0; i < settled.length; i++) {
			const result = settled[i];
			if (result.status === 'fulfilled') {
				results.push(result.value);
			} else {
				await log.error('character-card', `Failed to generate card for ${selected[i].character}`, result.reason);
			}
			// Report progress after each card settles (success or failure)
			if (onProgress) {
				onProgress({ completed: i + 1, total: selected.length, currentCharacter: selected[i].character });
			}
		}
	} else {
		for (let i = 0; i < selected.length; i++) {
			const entry = selected[i];
			const progress: GenerateProgress = {
				completed: i,
				total: selected.length,
				currentCharacter: entry.character,
			};

			try {
				const result = await generateCharacterCard(entry, lineage, onProgress, progress);
				results.push(result);
			} catch (err) {
				await log.error('character-card', `Failed to generate card for ${entry.character}`, err);
			}
		}
	}

	return results;
}

function validateEntries(entries: CharacterEntry[]): { selected: CharacterEntry[]; skipped: CharacterEntry[] } {
	const selected: CharacterEntry[] = [];
	const skipped: CharacterEntry[] = [];

	for (const entry of entries) {
		const isSelected = entry.isManual ? entry.character.trim().length > 0 : entry.include;
		if (isSelected) {
			selected.push(entry);
		} else {
			skipped.push(entry);
		}
	}

	return { selected, skipped };
}

function toUserModelMessage(content: string): ModelMessage {
	return { role: 'user', content };
}
