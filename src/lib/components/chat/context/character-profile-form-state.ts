import type { CharacterImportance, CharacterProfileEntity } from '#lib/db/character-profiles.ts';
import {
	normalizeSceneDetailText,
	parseSceneDetails,
	serializeSceneDetailEntries,
	type SceneDetailEntry,
} from '#lib/definitions/pipeline-sections.ts';
import type { ProfileDraft } from '#lib/features/character-profile-context.ts';

export type ProfileFormError = 'preferredNameRequired' | 'sceneDetailsInvalid' | 'importanceInvalid';

export type ProfileDraftResult = { draft: ProfileDraft; error: null } | { draft: null; error: ProfileFormError };

export interface ProfileFormInput {
	initial: CharacterProfileEntity | null;
	preferredName: string;
	aliasesText: string;
	logline: string;
	state: string;
	goal: string;
	relationships: string;
	voice: string;
	traitsText: string;
	importance: number;
	sceneEntries: SceneDetailEntry[];
}

export interface SceneDetailIssues {
	invalidRows: number[];
	duplicateNumbers: number[];
	valid: boolean;
}

export function splitCommaList(value: string): string[] {
	return value
		.split(',')
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

export function isValidSceneNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * Report which scene-detail rows cannot be saved: non-positive/non-integer numbers and
 * repeated scene numbers (the serialized form keys entries by scene number).
 */
export function inspectSceneDetailEntries(entries: SceneDetailEntry[]): SceneDetailIssues {
	const invalidRows: number[] = [];
	const seen: number[] = [];
	const duplicateNumbers: number[] = [];
	entries.forEach((entry, index) => {
		if (!isValidSceneNumber(entry.sceneNumber)) {
			invalidRows.push(index);
			return;
		}
		if (seen.includes(entry.sceneNumber)) {
			if (!duplicateNumbers.includes(entry.sceneNumber)) duplicateNumbers.push(entry.sceneNumber);
			return;
		}
		seen.push(entry.sceneNumber);
	});
	const sortedDuplicates = [...duplicateNumbers].sort((a, b) => a - b);
	return { invalidRows, duplicateNumbers: sortedDuplicates, valid: invalidRows.length === 0 && sortedDuplicates.length === 0 };
}

/** A new row takes the next free scene after the highest valid one, or scene 1. */
export function nextSceneNumber(entries: SceneDetailEntry[]): number {
	const validNumbers = entries.map((entry) => entry.sceneNumber).filter(isValidSceneNumber);
	return validNumbers.length > 0 ? Math.max(...validNumbers) + 1 : 1;
}

/**
 * Seed editor rows from a stored profile, flattening legacy multiline details to one line because
 * the editor only accepts single-line details.
 */
export function initialSceneEntries(initial: CharacterProfileEntity | null): SceneDetailEntry[] {
	if (initial === null) return [];
	return parseSceneDetails(initial.sceneDetails).map((entry) => ({ ...entry, details: normalizeSceneDetailText(entry.details) }));
}

/**
 * Descending display order (as indices into `entries`) computed once when the editor opens:
 * valid scene numbers first, invalid rows last in their original order. Preserving this order
 * afterwards keeps a focused row in place while the user edits its scene number.
 */
export function sceneDetailDisplayOrder(entries: SceneDetailEntry[]): number[] {
	return entries
		.map((entry, index) => ({ entry, index }))
		.sort((a, b) => {
			const aValid = isValidSceneNumber(a.entry.sceneNumber);
			const bValid = isValidSceneNumber(b.entry.sceneNumber);
			if (aValid && bValid && a.entry.sceneNumber !== b.entry.sceneNumber) return b.entry.sceneNumber - a.entry.sceneNumber;
			if (aValid !== bValid) return aValid ? -1 : 1;
			return a.index - b.index;
		})
		.map((row) => row.index);
}

/** Drop a removed row from a display-order list and shift the indices that followed it. */
export function removeDisplayIndex(order: number[], removedIndex: number): number[] {
	return order.filter((index) => index !== removedIndex).map((index) => (index > removedIndex ? index - 1 : index));
}

/**
 * Seed the alias input from an observed profile, hiding the preferred name because the form
 * re-adds it on submit. Keeping the old name only in the seed would drop it on rename.
 */
export function initialAliasesText(initial: CharacterProfileEntity | null): string {
	if (initial === null) return '';
	return initial.aliases.filter((alias) => alias !== initial.preferredName).join(', ');
}

/**
 * Submitted aliases: the typed list plus, on a rename, the previously preferred name so the
 * old name stays matchable. Save-time normalization re-adds the new preferred name and dedupes.
 */
export function buildProfileAliases(initial: CharacterProfileEntity | null, preferredName: string, aliasesText: string): string[] {
	const aliases = splitCommaList(aliasesText);
	const oldName = initial?.preferredName.trim() ?? '';
	const newName = preferredName.trim();
	if (oldName.length > 0 && oldName !== newName && !aliases.includes(oldName)) aliases.push(oldName);
	return aliases;
}

function optionalText(value: string): string | null {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function isCharacterImportance(value: number): value is CharacterImportance {
	return value === 1 || value === 2 || value === 3 || value === 4;
}

export function buildProfileDraft(input: ProfileFormInput): ProfileDraftResult {
	const preferredName = input.preferredName.trim();
	if (preferredName.length === 0) return { draft: null, error: 'preferredNameRequired' };

	const issues = inspectSceneDetailEntries(input.sceneEntries);
	if (!issues.valid) return { draft: null, error: 'sceneDetailsInvalid' };

	const { importance } = input;
	if (!isCharacterImportance(importance)) {
		return { draft: null, error: 'importanceInvalid' };
	}

	return {
		draft: {
			preferredName,
			aliases: buildProfileAliases(input.initial, preferredName, input.aliasesText),
			logline: input.logline.trim(),
			state: optionalText(input.state),
			goal: optionalText(input.goal),
			relationships: optionalText(input.relationships),
			voice: optionalText(input.voice),
			traits: splitCommaList(input.traitsText),
			sceneDetails: serializeSceneDetailEntries(input.sceneEntries),
			importance,
		},
		error: null,
	};
}
