import {
	CULTURES,
	DATA_NAME_TYPES,
	GENDERS,
	MEANING_TAGS,
	NAME_THEMES,
	type Culture,
	type DataNameType,
	type Gender,
	type MeaningTag,
	type NameEntry,
	type NameTheme,
} from './types';

function isGender(v: unknown): v is Gender {
	return typeof v === 'string' && (GENDERS as readonly string[]).includes(v);
}

function isCulture(v: unknown): v is Culture {
	return typeof v === 'string' && (CULTURES as readonly string[]).includes(v);
}

function isNameType(v: unknown): v is DataNameType {
	return typeof v === 'string' && (DATA_NAME_TYPES as readonly string[]).includes(v);
}

function isMeaningTag(v: unknown): v is MeaningTag {
	return typeof v === 'string' && (MEANING_TAGS as readonly string[]).includes(v);
}

function isNameTheme(v: unknown): v is NameTheme {
	return typeof v === 'string' && (NAME_THEMES as readonly string[]).includes(v);
}

function parseEntry(raw: unknown, index: number, onInvalid?: (index: number, reason: string) => void): NameEntry | null {
	const fail = (reason: string): null => {
		onInvalid?.(index, reason);
		return null;
	};

	if (raw == null || typeof raw !== 'object') return fail('entry is not an object');
	const entry = raw as Record<string, unknown>;

	const name = entry.name;
	if (typeof name !== 'string' || name.trim().length === 0) return fail('missing name');

	if (!Array.isArray(entry.genders) || entry.genders.length === 0) return fail('missing genders');
	const badGender = entry.genders.find((g) => !isGender(g));
	if (badGender !== undefined) return fail(`unknown gender "${String(badGender)}"`);

	if (!Array.isArray(entry.themes) || entry.themes.length === 0) return fail('missing themes');
	const badTheme = entry.themes.find((t) => !isNameTheme(t));
	if (badTheme !== undefined) return fail(`unknown theme "${String(badTheme)}"`);

	if (!Array.isArray(entry.cultures) || entry.cultures.length === 0) return fail('missing cultures');
	const badCulture = entry.cultures.find((c) => !isCulture(c));
	if (badCulture !== undefined) return fail(`unknown culture "${String(badCulture)}"`);

	if (!Array.isArray(entry.nameTypes) || entry.nameTypes.length === 0) return fail('missing nameTypes');
	const badNameType = entry.nameTypes.find((n) => !isNameType(n));
	if (badNameType !== undefined) return fail(`unknown nameType "${String(badNameType)}"`);

	const meaningTags = entry.meaningTags ?? [];
	if (!Array.isArray(meaningTags)) return fail('meaningTags is not an array');
	const badTag = meaningTags.find((t) => !isMeaningTag(t));
	if (badTag !== undefined) return fail(`unknown meaningTag "${String(badTag)}"`);

	return {
		name,
		genders: entry.genders as Gender[],
		themes: entry.themes as NameTheme[],
		cultures: entry.cultures as Culture[],
		nameTypes: entry.nameTypes as DataNameType[],
		meaningTags: meaningTags as MeaningTag[],
	};
}

/**
 * Parse a name dataset JSON file (an array of name entries). Invalid entries
 * are dropped and reported through `onInvalid` (with their 1-based index) so
 * the caller can surface data-quality issues without aborting the whole load.
 * Empty content yields an empty dataset; malformed JSON reports index 0.
 */
export function parseNameDataset(text: string, onInvalid?: (index: number, reason: string) => void): NameEntry[] {
	if (text.trim().length === 0) return [];

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		onInvalid?.(0, `invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
		return [];
	}

	if (!Array.isArray(parsed)) {
		onInvalid?.(0, 'expected a JSON array of name entries');
		return [];
	}

	const entries: NameEntry[] = [];
	for (let index = 0; index < parsed.length; index++) {
		const entry = parseEntry(parsed[index], index + 1, onInvalid);
		if (entry) entries.push(entry);
	}
	return entries;
}
