import { CULTURES, DATA_NAME_TYPES, GENDERS, MEANING_TAGS, type Culture, type DataNameType, type Gender, type MeaningTag, type NameEntry } from './types';

const MULTI_VALUE_SEPARATOR = ';';

/**
 * Parse a single CSV line into fields. Supports double-quoted fields containing
 * commas and escaped quotes (`""`). Embedded newlines are not supported — the
 * dataset format forbids them so files stay spreadsheet-editable.
 */
export function parseCsvLine(line: string): string[] {
	const fields: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"') {
				if (line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				current += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === ',') {
			fields.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	fields.push(current);
	return fields;
}

function splitMulti(value: string): string[] {
	return value
		.split(MULTI_VALUE_SEPARATOR)
		.map((v) => v.trim())
		.filter((v) => v.length > 0);
}

function isGender(v: string): v is Gender {
	return (GENDERS as readonly string[]).includes(v);
}

function isCulture(v: string): v is Culture {
	return (CULTURES as readonly string[]).includes(v);
}

function isNameType(v: string): v is DataNameType {
	return (DATA_NAME_TYPES as readonly string[]).includes(v);
}

function isMeaningTag(v: string): v is MeaningTag {
	return (MEANING_TAGS as readonly string[]).includes(v);
}

function isHeaderRow(fields: string[]): boolean {
	return fields.length > 0 && fields[0].trim().toLowerCase() === 'name';
}

function parseRow(line: string, lineNo: number, onInvalid?: (line: number, reason: string) => void): NameEntry | null {
	const fields = parseCsvLine(line);
	const fail = (reason: string): null => {
		onInvalid?.(lineNo, reason);
		return null;
	};

	const name = (fields[0] ?? '').trim();
	if (!name) return fail('missing name');

	const genders = splitMulti(fields[1] ?? '');
	if (genders.length === 0) return fail('missing gender');
	const badGender = genders.find((g) => !isGender(g));
	if (badGender) return fail(`unknown gender "${badGender}"`);

	const themes = splitMulti(fields[2] ?? '');
	if (themes.length === 0) return fail('missing themes');

	const cultures = splitMulti(fields[3] ?? '');
	if (cultures.length === 0) return fail('missing cultures');
	const badCulture = cultures.find((c) => !isCulture(c));
	if (badCulture) return fail(`unknown culture "${badCulture}"`);

	const nameTypes = splitMulti(fields[4] ?? '');
	if (nameTypes.length === 0) return fail('missing nameTypes');
	const badNameType = nameTypes.find((n) => !isNameType(n));
	if (badNameType) return fail(`unknown nameType "${badNameType}"`);

	const meaningTags = splitMulti(fields[5] ?? '');
	const badTag = meaningTags.find((t) => !isMeaningTag(t));
	if (badTag) return fail(`unknown meaningTag "${badTag}"`);

	return {
		name,
		genders: genders as Gender[],
		themes,
		cultures: cultures as Culture[],
		nameTypes: nameTypes as DataNameType[],
		meaningTags: meaningTags as MeaningTag[],
	};
}

/**
 * Parse CSV text into name entries. The first row is treated as a header and
 * skipped. Invalid rows are dropped and reported through `onInvalid` so the
 * caller can surface data-quality issues without aborting the whole load.
 */
export function parseNameDataset(text: string, onInvalid?: (line: number, reason: string) => void): NameEntry[] {
	const entries: NameEntry[] = [];
	const lines = text.split(/\r?\n/);

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index].trim();
		if (line.length === 0) continue;

		const fields = parseCsvLine(line);
		if (isHeaderRow(fields)) continue;

		const entry = parseRow(line, index + 1, onInvalid);
		if (entry) entries.push(entry);
	}

	return entries;
}
