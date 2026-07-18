import { generateText, type ModelMessage } from 'ai';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { createModel } from '$lib/ai/provider';
import { characterCardTemplateLoader, generalInstructionsLoader } from '$lib/fs/prompts';
import { exportActLine } from '$lib/ai/act-line-export';
import type { ActLineMeta } from '$lib/db/act-lines';
import { getMessagesForLine } from '$lib/db/act-lines';
import { type ActChainEntry, traceActLineChain } from '$lib/db/acts';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { type DirEntry, fs } from '$lib/fs/file-system';
import { kebabCase } from 'lodash-es';
import { log } from '$lib/logging/logger';
import { logCharacterCardActivity } from '$lib/logging/chat-logger';
import { getLineDir } from '$lib/ai/card-output-path';
import {
	actCardLabel,
	characterCardGenerationInstruction,
	characterCardGenerationSystemPrompt,
	characterCardLabel,
	characterExtractionPrefix,
	characterExtractionPrompt,
	characterExtractionSystemPrompt,
	transcriptEnd,
	transcriptStart,
} from './extraction-prompts';
import { ERR_NO_CHARACTERS_SELECTED, ERR_NO_MAIN_PROVIDER, ERR_NO_NARRATIVE_CONTENT } from '$lib/definitions/error-messages';
import { nameLabel } from '$lib/definitions/common-labels';
import { characterCardCoreIdentityLabel, characterCardExtractionRules } from '$lib/definitions/feature-prompts';
import { type CharacterProfileEntity, getLatestProfileByAlias, getLatestProfilesByActLine } from '$lib/db/character-profiles';
import { formatCharacterProfileAsMessage } from '$lib/definitions/pipeline-sections';
import { importanceLevelLabel } from '$lib/definitions/pipeline-prompts';

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
	canonicalName: string;
	importance: string;
}

export interface CharacterEntry extends CharacterSummary {
	include: boolean;
	isManual: boolean;
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

export interface EnsureCharacterCardParams {
	ctx: CharacterCardContext;
	character: CharacterSummary;
	abortSignal?: AbortSignal;
}

export interface EnsureCharacterCardResult {
	content: string;
	generated: boolean;
}

// === Exported Functions ===

export function toCharacterEntries(summaries: CharacterSummary[]): CharacterEntry[] {
	return summaries.map((s) => ({
		...s,
		include: true,
		isManual: false,
	}));
}

export function toCharacterSummary(profile: CharacterProfileEntity): CharacterSummary {
	return {
		character: profile.preferredName,
		canonicalName: profile.canonicalName,
		importance: `${importanceLevelLabel(profile.importance)}: ${profile.logline}`,
	};
}

export async function extractCharactersFromActLine(ctx: CharacterCardContext): Promise<CharacterSummary[]> {
	const summaries = await extractCharactersFromActLineProfiles(ctx);
	return summaries.length > 0 ? summaries : extractCharactersFromActLineMessages(ctx);
}

export async function generateCharacterCard(
	ctx: CharacterCardContext,
	entry: CharacterSummary,
	lineage: ActChainEntry[]
): Promise<CharacterCardResult> {
	const config = getMainProviderConfig();
	if (!config?.model) throw new Error(ERR_NO_MAIN_PROVIDER);

	const canonicalName = kebabCase(entry.canonicalName).trim();
	if (!canonicalName) {
		throw new Error(`Character name resolves to empty identifier: "${entry.character}"`);
	}

	const storyFolder = await resolveStoryFolder(ctx.storyId, ctx.storyName);

	// Backup existing card before regeneration
	const charactersDir = await resolveCharactersDir(storyFolder, ctx);
	const filePath = `${charactersDir}/${computeCardFilename(canonicalName)}`;
	let backupPath: string | null = null;
	if (await fs.exists(filePath)) {
		const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
		backupPath = `${charactersDir}/${canonicalName}-${timestamp}.md`;
		await fs.rename(filePath, backupPath);
	}

	const messages = await buildUserMessages(ctx, entry, lineage, storyFolder);
	await logCharacterCardActivity('generation-start', `Character: ${entry.character}\n\nMessages:\n${JSON.stringify(messages, null, 2)}`);
	try {
		const model = await createModel(config);
		const generalInstructions = await generalInstructionsLoader.loadByStory(ctx.storyId, ctx.storyName);
		const combinedSystem = `${characterCardGenerationSystemPrompt(entry.character)}\n\n---\n\n${generalInstructions}`;
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

	const lineage = await traceActLineChain(ctx.actLineId, true);

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
			if (onProgress) {
				onProgress({ completed: i, total: selected.length, currentCharacter: entry.character });
			}

			try {
				const result = await generateCharacterCard(ctx, entry, lineage);
				results.push(result);
			} catch (err) {
				await log.error('character-card', `Failed to generate card for ${entry.character}`, err);
			}
		}
	}

	return results;
}

export async function ensureCharacterCard(params: EnsureCharacterCardParams): Promise<EnsureCharacterCardResult> {
	const storyFolder = await resolveStoryFolder(params.ctx.storyId, params.ctx.storyName);

	// 1. Check current act line
	const current = await loadExistingCharacterCard(
		storyFolder,
		params.ctx.actNumber,
		params.character.canonicalName,
		params.ctx.actLine.isMainLine ?? false,
		params.ctx.actLineId
	);
	if (current) {
		return { content: current, generated: false };
	}

	// 2. Walk lineage (excluding current act) for an existing card
	const lineage = await traceActLineChain(params.ctx.actLineId, true);
	for (const entry of lineage) {
		if (entry.actLineId === params.ctx.actLineId) continue;
		const existing = await loadExistingCharacterCard(
			storyFolder,
			entry.actNumber,
			params.character.canonicalName,
			entry.isMainLine,
			entry.actLineId
		);
		if (existing) {
			return { content: existing, generated: false };
		}
	}

	// 3. Not found anywhere in lineage — generate for current act line
	const result = await generateCharacterCard(params.ctx, params.character, lineage);
	return { content: result.content, generated: true };
}

export async function loadLatestCharacterCardsForActLine(ctx: CharacterCardContext): Promise<LoadedCharacterCard[]> {
	const storyFolder = await resolveStoryFolder(ctx.storyId, ctx.storyName);
	const lineage = await traceActLineChain(ctx.actLineId, true);
	const found = new Map<string, LoadedCharacterCard>();

	for (const entry of lineage) {
		const lineDir = await getLineDir(storyFolder, entry.actNumber, entry.isMainLine, entry.actLineId);
		const cards = await readCardFiles(`${lineDir}/characters`);
		for (const { name, content } of cards) {
			if (!found.has(name)) found.set(name, { canonicalName: name, content });
		}
	}

	return [...found.values()];
}

export async function getExistingCardNamesForActLine(ctx: CharacterCardContext): Promise<Set<string>> {
	const storyFolder = await resolveStoryFolder(ctx.storyId, ctx.storyName);
	const charactersDir = await resolveCharactersDir(storyFolder, ctx);
	const cards = await readCardFiles(charactersDir);
	return new Set(cards.map((c) => c.name));
}

// === Local Functions ===

const BACKUP_FILE_PATTERN = /-\d{14}$/;

function toUserModelMessage(content: string): ModelMessage {
	return { role: 'user', content };
}

async function readCardFiles(dir: string): Promise<{ name: string; content: string }[]> {
	if (!(await fs.exists(dir))) return [];
	const entries = await fs.readDir(dir);
	const out: { name: string; content: string }[] = [];
	for (const file of entries) {
		if (file.isDirectory || !file.name.endsWith('.md')) continue;
		const name = file.name.slice(0, -3);
		if (BACKUP_FILE_PATTERN.test(name)) continue;
		const content = await fs.readTextFileIfExists(`${dir}/${file.name}`);
		if (content) out.push({ name, content });
	}
	return out;
}

async function extractCharactersFromActLineProfiles(ctx: CharacterCardContext): Promise<CharacterSummary[]> {
	const profiles = await getLatestProfilesByActLine(ctx.actLineId);
	return profiles.map(toCharacterSummary);
}

async function extractCharactersFromActLineMessages(ctx: CharacterCardContext): Promise<CharacterSummary[]> {
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

	return parseCharacterJson(result.text);
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
				canonicalName: kebabCase(item.character as string),
				importance: item.importance as string,
			}));
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`PARSE_FAILED:${msg}\n${text}`);
	}
}

export { parseCharacterJson as _parseCharacterJsonForTest };

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

function computeCardFilename(canonicalName: string): string {
	return `${canonicalName}.md`;
}

export { computeCardFilename as _computeCardFilenameForTest };

async function resolveCharactersDir(storyFolder: string, ctx: CharacterCardContext): Promise<string> {
	const isMainLine = ctx.actLine.isMainLine ?? false;
	const lineDir = await getLineDir(storyFolder, ctx.actNumber, isMainLine, ctx.actLineId);
	return `${lineDir}/characters`;
}

async function loadExistingCharacterCard(
	storyFolder: string,
	actNumber: number,
	canonicalName: string,
	isMainLine: boolean,
	actLineId: string
): Promise<string | null> {
	const sanitizedCanonicalName = kebabCase(canonicalName).trim();
	if (!sanitizedCanonicalName) {
		await log.warn('character-card', `canonicalName='${canonicalName}' resolved to empty string`);
		return null;
	}

	const lineDir = await getLineDir(storyFolder, actNumber, isMainLine, actLineId);
	const charactersDir = `${lineDir}/characters`;
	const filename = computeCardFilename(sanitizedCanonicalName);
	const path = `${charactersDir}/${filename}`;

	try {
		const content = await fs.readTextFileIfExists(path);
		return content ?? null;
	} catch (err) {
		await log.warn('character-card', `Failed to read character card at ${path}: ${err}`);
		return null;
	}
}

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

async function loadPreviousActCards(storyFolder: string, lineage: ActChainEntry[], skipActNumber: number): Promise<string[]> {
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
	lineage: ActChainEntry[],
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

async function characterCardExtractionPrompt(entry: CharacterSummary, ctx: CharacterCardContext) {
	const rules = characterCardExtractionRules(entry.character);
	const template = await characterCardTemplateLoader.loadByStory(ctx.storyId, ctx.storyName);

	const namedTemplate = template
		.replaceAll('{{coreIdentity}}', characterCardCoreIdentityLabel())
		.replaceAll('{{name}}', nameLabel())
		.replaceAll('{{character name}}', entry.character);

	return characterCardGenerationInstruction(rules, namedTemplate);
}

function toMessages(
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

async function buildUserMessages(ctx: CharacterCardContext, entry: CharacterSummary, lineage: ActChainEntry[], storyFolder: string) {
	// Exclude current act line from character card context (the card being generated/regenerated should not be fed back as context)
	const lineageExcludingCurrent = lineage.filter((l) => l.actLineId !== ctx.actLineId);
	const [previousActCards, existingCards, characterProfile] = await Promise.all([
		loadPreviousActCards(storyFolder, lineage, ctx.actNumber),
		loadPreviousCharacterCards(storyFolder, lineageExcludingCurrent, entry.canonicalName, entry.character),
		getLatestProfileByAlias(ctx.actLineId, entry.canonicalName),
	]);

	const allMessages = await getMessagesForLine(ctx.actLineId);
	const transcript = exportActLine(allMessages);
	const userPrompt = await characterCardExtractionPrompt(entry, ctx);
	const formattedCharacterProfile = characterProfile ? formatCharacterProfileAsMessage(characterProfile) : null;

	return toMessages(transcript, previousActCards, existingCards, formattedCharacterProfile, userPrompt);
}
