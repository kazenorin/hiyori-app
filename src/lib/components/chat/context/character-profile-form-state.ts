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
	aliases: string[];
	logline: string;
	state: string;
	goal: string;
	relationships: string;
	voice: string;
	traits: string[];
	importance: number;
	sceneEntries: SceneDetailEntry[];
}

export interface SceneDetailIssues {
	invalidRows: number[];
	duplicateNumbers: number[];
	valid: boolean;
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

export interface SceneDetailRange {
	min: number;
	max: number;
}

export type SceneDetailRow =
	{ kind: 'entry'; index: number; sceneNumber: number; range: SceneDetailRange } | { kind: 'add'; key: string; range: SceneDetailRange };

/**
 * Build the table rows for a profile's scene details in ascending scene order. Scene numbers are
 * normally fixed; a row becomes editable only when the gap below it has at least two free scenes,
 * in which case it may shift down inside that gap. Each free gap also gets an add row covering
 * exactly its missing scenes, emitted before the entry above it. Rows above the latest scene stay
 * visible but fixed.
 */
export function buildSceneDetailRows(entries: SceneDetailEntry[], latestScene: number): SceneDetailRow[] {
	const valid = entries
		.map((entry, index) => ({ entry, index }))
		.filter(({ entry }) => isValidSceneNumber(entry.sceneNumber))
		.sort((a, b) => a.entry.sceneNumber - b.entry.sceneNumber || a.index - b.index);

	const future = valid.filter(({ entry }) => entry.sceneNumber > latestScene);
	const within = valid.filter(({ entry }) => entry.sceneNumber <= latestScene);
	const rows: SceneDetailRow[] = [];

	const addRow = (min: number, max: number): void => {
		if (min <= max) rows.push({ kind: 'add', key: `${min}:${max}`, range: { min, max } });
	};

	if (within.length === 0) {
		addRow(1, latestScene);
	} else {
		let lower = 0;
		for (const { entry, index } of within) {
			const scene = entry.sceneNumber;
			const gapMin = lower + 1;
			addRow(gapMin, scene - 1);
			rows.push({
				kind: 'entry',
				index,
				sceneNumber: scene,
				range: scene - gapMin >= 2 ? { min: gapMin, max: scene } : { min: scene, max: scene },
			});
			lower = scene;
		}
		addRow(lower + 1, latestScene);
	}

	for (const { entry, index } of future) {
		rows.push({
			kind: 'entry',
			index,
			sceneNumber: entry.sceneNumber,
			range: { min: entry.sceneNumber, max: entry.sceneNumber },
		});
	}

	return rows;
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
 * Seed the alias tags from an observed profile, hiding the preferred name because the form
 * re-adds it on submit. Keeping the old name only in the seed would drop it on rename.
 */
export function initialAliases(initial: CharacterProfileEntity | null): string[] {
	if (initial === null) return [];
	return initial.aliases.filter((alias) => alias !== initial.preferredName);
}

/**
 * Submitted aliases: the tag list plus, on a rename, the previously preferred name so the
 * old name stays matchable. Save-time normalization re-adds the new preferred name and dedupes.
 */
export function buildProfileAliases(initial: CharacterProfileEntity | null, preferredName: string, aliases: string[]): string[] {
	const merged = aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0);
	const oldName = initial?.preferredName.trim() ?? '';
	const newName = preferredName.trim();
	if (oldName.length > 0 && oldName !== newName && !merged.includes(oldName)) merged.push(oldName);
	return merged;
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
			aliases: buildProfileAliases(input.initial, preferredName, input.aliases),
			logline: input.logline.trim(),
			state: optionalText(input.state),
			goal: optionalText(input.goal),
			relationships: optionalText(input.relationships),
			voice: optionalText(input.voice),
			traits: input.traits.map((trait) => trait.trim()).filter((trait) => trait.length > 0),
			sceneDetails: serializeSceneDetailEntries(input.sceneEntries),
			importance,
		},
		error: null,
	};
}
