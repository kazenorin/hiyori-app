import {
	extractCharactersFromActLine,
	generateCharacterCards,
	toCharacterEntries,
	type CharacterEntry,
	type CharacterCardResult,
	type GenerateProgress,
} from '$lib/features/character-card-generator';
import { log } from '$lib/logging/logger';

let characters = $state<CharacterEntry[]>([]);
let isExtracting = $state(false);
let isGenerating = $state(false);
let extractionError = $state<string | null>(null);
let generationError = $state<string | null>(null);
let rawExtractionOutput = $state<string | null>(null);
let progress = $state<GenerateProgress | null>(null);
let results = $state<CharacterCardResult[]>([]);

export function getCharacters(): CharacterEntry[] {
	return characters;
}

export function getIsExtracting(): boolean {
	return isExtracting;
}

export function getIsGenerating(): boolean {
	return isGenerating;
}

export function getExtractionError(): string | null {
	return extractionError;
}

export function getGenerationError(): string | null {
	return generationError;
}

export function getRawExtractionOutput(): string | null {
	return rawExtractionOutput;
}

export function getProgress(): GenerateProgress | null {
	return progress;
}

export function getResults(): CharacterCardResult[] {
	return results;
}

export async function extractCharacters(): Promise<void> {
	isExtracting = true;
	extractionError = null;
	rawExtractionOutput = null;
	characters = [];

	try {
		const summaries = await extractCharactersFromActLine();
		characters = toCharacterEntries(summaries);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to extract characters.';

		if (message.startsWith('PARSE_FAILED:')) {
			rawExtractionOutput = message.slice('PARSE_FAILED:'.length);
			extractionError = 'Could not parse character list. Please add rows manually.';
		} else {
			extractionError = message;
		}

		await log.error('character-card', message, err);
	} finally {
		isExtracting = false;
	}
}

export async function generateCards(parallel: boolean): Promise<void> {
	if (isGenerating) return;

	isGenerating = true;
	generationError = null;
	progress = null;
	results = [];

	try {
		results = await generateCharacterCards(characters, parallel, (p) => {
			progress = p;
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to generate character cards.';
		generationError = message;
		await log.error('character-card', message, err);
	} finally {
		isGenerating = false;
	}
}

export function updateCharacter(index: number, updates: Partial<CharacterEntry>): void {
	if (index < 0 || index >= characters.length) return;
	const entry = characters[index];
	characters[index] = { ...entry, ...updates };
}

export function addManualCharacter(): void {
	characters = [
		...characters,
		{
			character: '',
			importance: '',
			canonicalName: '',
			include: true,
			isManual: true,
		},
	];
}

export function removeCharacter(index: number): void {
	if (index < 0 || index >= characters.length) return;
	if (!characters[index].isManual) return;
	characters = characters.filter((_, i) => i !== index);
}

export function resetState(): void {
	characters = [];
	extractionError = null;
	generationError = null;
	rawExtractionOutput = null;
	progress = null;
	results = [];
}
