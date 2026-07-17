import { generateText, type ModelMessage } from 'ai';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { createModel } from '$lib/ai/provider';
import { characterCardTemplateLoader, generalInstructionsLoader } from '$lib/fs/prompts';
import { exportActLine } from '$lib/ai/act-line-export';
import { getMessagesForLine, getActLine } from '$lib/db/act-lines';
import type { ActLineMeta } from '$lib/db/act-lines';
import { getAct } from '$lib/db/acts';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { fs, type DirEntry } from '$lib/fs/file-system';
import { kebabCase } from 'lodash-es';
import { log } from '$lib/logging/logger';
import { logCharacterCardActivity } from '$lib/logging/chat-logger';
import { getLineDir } from '$lib/ai/card-output-path';
import { actCardLabel, characterCardLabel } from './extraction-prompts';
import {
	transcriptStart,
	transcriptEnd,
	characterExtractionPrefix,
	characterExtractionPrompt,
	characterCardGenerationInstruction,
	characterExtractionSystemPrompt,
	characterCardGenerationSystemPrompt,
} from './extraction-prompts';
import { ERR_NO_MAIN_PROVIDER, ERR_NO_NARRATIVE_CONTENT, ERR_NO_CHARACTERS_SELECTED } from '$lib/definitions/error-messages';
import { nameLabel } from '$lib/definitions/common-labels';
import { characterCardExtractionRules, characterCardCoreIdentityLabel } from '$lib/definitions/feature-prompts';
import { getLatestProfileByAlias } from '$lib/db/character-profiles';
import { formatCharacterProfileAsMessage } from '$lib/definitions/pipeline-sections';

// === Types ===

export interface CharacterCardContext {
	storyId: string;
	storyName: string;
	actLineId: string;
	actLine: ActLineMeta;
	actNumber: number;
}

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

export interface LoadedCharacterCard {
	canonicalName: string;
	content: string;
}

// === Character Entry Helpers ===

export function toCharacterEntries(summaries: CharacterSummary[]): CharacterEntry[] {
	return summaries.map((s) => ({
		character: s.character,
		importance: s.importance,
		canonicalName: kebabCase(s.character),
		include: true,
		isManual: false,
	}));
}

// === Extraction ===

export async function extractCharactersFromActLine(ctx: CharacterCardContext): Promise<CharacterSummary[]> {
	const config = getMainProviderConfig();
	if (!config?.model) throw new Error(ERR_NO_MAIN_PROVIDER);

	const allMessages = await getMessagesForLine(ctx.actLineId);
	const transcript: string[] = exportActLine(allMessages);
	if (transcript.length === 0) throw new Error(ERR_NO_NARRATIVE_CONTENT);

	const systemPrompt = characterExtractionSystemPrompt();

	const model = await createModel(config);

	await logCharacterCardActivity(
		'extraction-start',
		`Extracting characters from act line: ${ctx.actLineId}\n
  System Prompt:\n${systemPrompt}\n
  Transcript:\n    ${transcript.join('\n    ')}`
	);

	const messages: ModelMessage[] = [
		{
			role: 'user',
			content: characterExtractionPrefix(),
		},
		...transcript.map(toUserModelMessage),
		{ role: 'user', content: transcriptEnd() },
		{
			role: 'user',
			content: characterExtractionPrompt(),
		},
	];
	const result = await generateText({ model, system: systemPrompt, messages, ...(config.callSettings ?? {}) });

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
 * Walk the act chain backwards from the given act line via `continuesFromActLineId`.
 * Returns entries sorted newest-first. A `visited` set prevents infinite loops
 * if the chain is somehow circular.
 */
export async function buildActLineage(ctx: CharacterCardContext): Promise<ActLineageEntry[]> {
	const lineage: ActLineageEntry[] = [];
	const visited = new Set<string>();

	let currentActId: string | null = ctx.actLine.actId;
	let currentActLineId: string | null = ctx.actLineId;

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

async function loadActCard(storyFolder: string, actNumber: number, isMainLine: boolean, actLineId: string): Promise<string | null> {
	const lineDir = await getLineDir(storyFolder, actNumber, isMainLine, actLineId);

	try {
		const entries = await fs.readDir(lineDir);
		const actCardFile = entries.find((e: DirEntry) => !e.isDirectory && e.name.startsWith('act-card-') && e.name.endsWith('.md'));
		if (!actCardFile) return null;
		const content = await fs.readTextFileIfExists(`${lineDir}/${actCardFile.name}`);
		return content ?? null;
	} catch (err) {
		await log.warn('character-card', `Failed to read act card in ${lineDir}: ${err}`);
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
	const lineDir = await getLineDir(storyFolder, actNumber, isMainLine, actLineId);
	const charactersDir = `${lineDir}/characters`;
	const filename = computeCardFilename(canonicalName);
	const path = `${charactersDir}/${filename}`;

	try {
		const content = await fs.readTextFileIfExists(path);
		return content ?? null;
	} catch (err) {
		await log.warn('character-card', `Failed to read character card at ${path}: ${err}`);
		return null;
	}
}

// === Context Building ===

async function loadPreviousActCards(storyFolder: string, lineage: ActLineageEntry[], skipActNumber: number): Promise<string[]> {
	const sections: string[] = [];
	for (const entry of lineage) {
		if (entry.actNumber === skipActNumber) continue;

		const actCard = await loadActCard(storyFolder, entry.actNumber, entry.isMainLine, entry.actLineId);
		if (actCard) {
			sections.push(actCardLabel(entry.actNumber));
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
		const card = await loadExistingCharacterCard(storyFolder, entry.actNumber, canonicalName, entry.isMainLine, entry.actLineId);
		if (card) {
			sections.push(characterCardLabel(characterName, entry.actNumber));
			sections.push(card);
		}
	}
	return sections;
}

function buildGenerationMessages(
	transcript: string[],
	previousActCards: string[],
	existingCards: string[],
	characterProfile: string | null,
	userPrompt: string
): ModelMessage[] {
	return [
		{ role: 'user', content: transcriptStart() },
		...transcript.map(toUserModelMessage),
		{ role: 'user', content: transcriptEnd() },
		...previousActCards.map(toUserModelMessage),
		...existingCards.map(toUserModelMessage),
		...(characterProfile ? [toUserModelMessage(characterProfile)] : []),
		{ role: 'user', content: userPrompt },
	];
}

// === Card Generation ===

export async function generateCharacterCard(
	ctx: CharacterCardContext,
	entry: CharacterEntry,
	lineage: ActLineageEntry[],
	onProgress?: (progress: GenerateProgress) => void,
	progress?: GenerateProgress
): Promise<CharacterCardResult> {
	const config = getMainProviderConfig();
	if (!config?.model) throw new Error(ERR_NO_MAIN_PROVIDER);

	if (!entry.canonicalName.trim()) {
		throw new Error(`Character name resolves to empty identifier: "${entry.character}"`);
	}

	if (onProgress && progress) {
		onProgress(progress);
	}

	// Load prompts
	const [template, generalInstructions] = await Promise.all([
		characterCardTemplateLoader.loadByStory(ctx.storyId, ctx.storyName),
		generalInstructionsLoader.loadByStory(ctx.storyId, ctx.storyName),
	]);

	const extractionPrompt = characterCardExtractionRules();

	const combinedSystem = `${characterCardGenerationSystemPrompt(entry.character)}\n\n---\n\n${generalInstructions}`;
	const namedExtractionPrompt = extractionPrompt.replaceAll('{{character name}}', entry.character);
	const namedTemplate = template
		.replaceAll('{{coreIdentity}}', characterCardCoreIdentityLabel())
		.replaceAll('{{name}}', nameLabel())
		.replaceAll('{{character name}}', entry.character);

	// Load transcript and context
	const allMessages = await getMessagesForLine(ctx.actLineId);
	const transcript = exportActLine(allMessages);

	const storyFolder = await resolveStoryFolder(ctx.storyId, ctx.storyName);

	const currentActNumber = ctx.actNumber;

	// Use lineage entry for isMainLine to avoid redundant DB query
	const currentLineageEntry = lineage.find((l) => l.actLineId === ctx.actLineId);
	const isMainLine = currentLineageEntry?.isMainLine ?? false;

	const lineDir = await getLineDir(storyFolder, currentActNumber, isMainLine, ctx.actLineId);
	const charactersDir = `${lineDir}/characters`;
	const filename = computeCardFilename(entry.canonicalName);
	const filePath = `${charactersDir}/${filename}`;

	// Exclude current act line from character card context (the card being generated/regenerated
	// should not be fed back as context)
	const lineageExcludingCurrent = lineage.filter((l) => l.actLineId !== ctx.actLineId);

	const [previousActCards, existingCards, characterProfile] = await Promise.all([
		loadPreviousActCards(storyFolder, lineage, currentActNumber),
		loadPreviousCharacterCards(storyFolder, lineageExcludingCurrent, entry.canonicalName, entry.character),
		getLatestProfileByAlias(ctx.actLineId, entry.canonicalName),
	]);

	const formattedCharacterProfile = characterProfile ? formatCharacterProfileAsMessage(characterProfile) : null;
	const userPrompt = characterCardGenerationInstruction(namedExtractionPrompt, namedTemplate);
	const messages = buildGenerationMessages(transcript, previousActCards, existingCards, formattedCharacterProfile, userPrompt);

	const model = await createModel(config);

	await logCharacterCardActivity('generation-start', `Character: ${entry.character}\n\nMessages:\n${JSON.stringify(messages, null, 2)}`);

	// Backup existing card before regeneration
	let backupPath: string | null = null;
	if (await fs.exists(filePath)) {
		const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
		backupPath = `${charactersDir}/${entry.canonicalName}-${timestamp}.md`;
		await fs.rename(filePath, backupPath);
	}

	try {
		const result = await generateText({ model, system: combinedSystem, messages, ...(config.callSettings ?? {}) });

		await logCharacterCardActivity(
			'generation-end',
			`
  Character: ${entry.character}
  Result: ${result.text}
  Usage: ${JSON.stringify(result.usage, null, 4)}
  Finish Reason: ${result.finishReason}`
		);

		await fs.writeTextFileEnsuringDir(filePath, result.text);

		return {
			characterName: entry.character,
			filePath,
			content: result.text,
		};
	} catch (err) {
		if (backupPath && (await fs.exists(backupPath))) {
			await fs.rename(backupPath, filePath);
		}
		throw err;
	}
}

export async function generateCharacterCards(
	ctx: CharacterCardContext,
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

	if (selected.length === 0) throw new Error(ERR_NO_CHARACTERS_SELECTED);
	if (onProgress) {
		// report initial progress
		onProgress({ completed: 0, total: selected.length, currentCharacter: selected[0].character });
	}

	const lineage = await buildActLineage(ctx);

	const results: CharacterCardResult[] = [];

	if (parallel) {
		const promises = selected.map((entry) => generateCharacterCard(ctx, entry, lineage));
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
				const result = await generateCharacterCard(ctx, entry, lineage, onProgress, progress);
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

// === Ensure / Load / Copy Helpers ===

export interface EnsureCharacterCardOptions {
	ctx: CharacterCardContext;
	canonicalName: string;
	preferredName: string;
	abortSignal?: AbortSignal;
}

export interface EnsureCharacterCardResult {
	content: string;
	generated: boolean;
}

export async function ensureCharacterCard(opts: EnsureCharacterCardOptions): Promise<EnsureCharacterCardResult> {
	const storyFolder = await resolveStoryFolder(opts.ctx.storyId, opts.ctx.storyName);

	// 1. Check current act line
	const lineDir = await getLineDir(storyFolder, opts.ctx.actNumber, opts.ctx.actLine.isMainLine ?? false, opts.ctx.actLineId);
	const cardPath = `${lineDir}/characters/${opts.canonicalName}.md`;
	if (await fs.exists(cardPath)) {
		return { content: await fs.readTextFile(cardPath), generated: false };
	}

	// 2. Walk lineage (excluding current act) for an existing card
	const lineage = await buildActLineage(opts.ctx);
	for (const entry of lineage) {
		if (entry.actLineId === opts.ctx.actLineId) continue;
		const existing = await loadExistingCharacterCard(storyFolder, entry.actNumber, opts.canonicalName, entry.isMainLine, entry.actLineId);
		if (existing) {
			return { content: existing, generated: false };
		}
	}

	// 3. Not found anywhere in lineage — generate for current act line
	const entry: CharacterEntry = {
		character: opts.preferredName,
		importance: '',
		canonicalName: opts.canonicalName,
		include: true,
		isManual: true,
	};
	const result = await generateCharacterCard(opts.ctx, entry, lineage);
	return { content: result.content, generated: true };
}

export async function loadLatestCharacterCardsForActLine(ctx: CharacterCardContext): Promise<LoadedCharacterCard[]> {
	const storyFolder = await resolveStoryFolder(ctx.storyId, ctx.storyName);
	const lineage = await buildActLineage(ctx);
	const found = new Map<string, LoadedCharacterCard>();

	for (const entry of lineage) {
		const lineDir = await getLineDir(storyFolder, entry.actNumber, entry.isMainLine, entry.actLineId);
		const charactersDir = `${lineDir}/characters`;
		if (!(await fs.exists(charactersDir))) continue;
		const entries = await fs.readDir(charactersDir);
		for (const file of entries) {
			if (file.isDirectory || !file.name.endsWith('.md')) continue;
			const canonicalName = file.name.slice(0, -3);
			if (found.has(canonicalName)) continue;
			const content = await fs.readTextFile(`${charactersDir}/${file.name}`);
			found.set(canonicalName, { canonicalName, content });
		}
	}

	return [...found.values()];
}

export async function getExistingCardNamesForActLine(ctx: CharacterCardContext): Promise<Set<string>> {
	const storyFolder = await resolveStoryFolder(ctx.storyId, ctx.storyName);
	const lineDir = await getLineDir(storyFolder, ctx.actNumber, ctx.actLine.isMainLine ?? false, ctx.actLineId);
	const charactersDir = `${lineDir}/characters`;
	if (!(await fs.exists(charactersDir))) return new Set();
	const entries = await fs.readDir(charactersDir);
	const names = new Set<string>();
	for (const file of entries) {
		if (file.isDirectory || !file.name.endsWith('.md')) continue;
		const name = file.name.slice(0, -3);
		if (/-\d{14}$/.test(name)) continue;
		names.add(name);
	}
	return names;
}
