import { kebabCase } from 'lodash-es';
import {
	CULTURE_META,
	DATA_NAME_TYPES,
	DEFAULT_AVOIDANCE,
	DEFAULT_COUNT,
	MAX_AVOIDANCE,
	MAX_COUNT,
	type Culture,
	type DataNameType,
	type MeaningTag,
	type NameEntry,
	type NameOrder,
	type NameQuery,
	type SuggestedName,
} from './types';

/**
 * Normalize a name for collision/dedup comparison using the codebase's canonical
 * name form (kebab-case) — the same technique as `toCanonicalName` in
 * `character-profiles.ts`. Applied to both suggested and existing names so matching
 * stays consistent and whitespace/punctuation variants collide correctly
 * (e.g. "Elena M. O'Brien" → "elena-m-obrien").
 */
export function normalizeName(value: string): string {
	return kebabCase(value);
}

/**
 * Build the set of names already in use (preferred names plus aliases),
 * normalized. Used to keep analytic suggestions from reusing an existing name.
 */
export function buildExistingNameSet(existing: { preferredName: string; aliases: string[] }[]): Set<string> {
	const set = new Set<string>();
	for (const entry of existing) {
		set.add(normalizeName(entry.preferredName));
		for (const alias of entry.aliases) set.add(normalizeName(alias));
	}
	return set;
}

/** A name matches a dimension when its value set intersects the query's set; an empty query imposes no constraint. */
function intersects<T>(entryValues: T[], queryValues?: T[]): boolean {
	if (!queryValues || queryValues.length === 0) return true;
	return entryValues.some((v) => queryValues.includes(v));
}

/**
 * Whether an entry passes the shared gender/theme/culture filters. `ignoreGender`
 * is used when selecting family names for composition — surnames are shared across
 * genders, so gender is carried by the given name only.
 */
function matchesFilters(entry: NameEntry, query: NameQuery, ignoreGender: boolean): boolean {
	if (!ignoreGender && !intersects(entry.genders, query.genders)) return false;
	if (!intersects(entry.themes, query.themes)) return false;
	if (!intersects(entry.cultures, query.cultures)) return false;
	return true;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
	const arr = [...items];
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

function unionTags(a: readonly MeaningTag[], b: readonly MeaningTag[]): MeaningTag[] {
	const set = new Set<MeaningTag>(a);
	for (const tag of b) set.add(tag);
	return Array.from(set);
}

/** Separator used to join the two parts of a composed full name. */
function fullNameSeparator(order: NameOrder, locale: string): string {
	if (locale === 'zh-Hant-HK') return order === 'givenFirst' ? '·' : '';
	return ' ';
}

/** Compose a full name from given + family parts according to culture order and locale formatting. */
export function formatFullName(given: string, family: string, order: NameOrder, locale: string): string {
	if (order === 'noFamily') return given;
	const sep = fullNameSeparator(order, locale);
	return order === 'familyFirst' ? `${family}${sep}${given}` : `${given}${sep}${family}`;
}

function groupByCulture(entries: NameEntry[]): Map<Culture, NameEntry[]> {
	const map = new Map<Culture, NameEntry[]>();
	for (const entry of entries) {
		for (const culture of entry.cultures) {
			const list = map.get(culture) ?? [];
			list.push(entry);
			map.set(culture, list);
		}
	}
	return map;
}

/**
 * Compose full-name candidates by pairing culture-compatible given and family
 * entries. Family selection ignores gender; cultures without family names
 * (noFamily) are skipped.
 */
function composeFullNames(dataset: NameEntry[], query: NameQuery, locale: string, rng: () => number): SuggestedName[] {
	const givens = dataset.filter((e) => e.nameTypes.includes('given') && matchesFilters(e, query, false));
	const families = dataset.filter((e) => e.nameTypes.includes('family') && matchesFilters(e, query, true));

	const givenByCulture = groupByCulture(givens);
	const familyByCulture = groupByCulture(families);

	const composed: SuggestedName[] = [];
	for (const [culture, givenPool] of givenByCulture) {
		const familyPool = familyByCulture.get(culture);
		if (!familyPool || familyPool.length === 0) continue;

		const order = CULTURE_META[culture].nameOrder;
		if (order === 'noFamily') continue;

		const shuffledGivens = shuffle(givenPool, rng);
		const shuffledFamilies = shuffle(familyPool, rng);
		const pairCount = Math.min(shuffledGivens.length, shuffledFamilies.length);
		for (let i = 0; i < pairCount; i++) {
			const given = shuffledGivens[i];
			const family = shuffledFamilies[i];
			composed.push({
				name: formatFullName(given.name, family.name, order, locale),
				meaningTags: unionTags(given.meaningTags, family.meaningTags),
			});
		}
	}
	return composed;
}

function buildCandidates(dataset: NameEntry[], query: NameQuery, locale: string, rng: () => number): SuggestedName[] {
	const requested = query.nameTypes;
	const wantFull = requested?.includes('full') ?? false;
	const directForms: DataNameType[] = requested ? DATA_NAME_TYPES.filter((t) => requested.includes(t)) : [...DATA_NAME_TYPES];

	const candidates: SuggestedName[] = [];

	if (directForms.length > 0) {
		for (const entry of dataset) {
			if (!entry.nameTypes.some((t) => directForms.includes(t))) continue;
			if (!matchesFilters(entry, query, false)) continue;
			candidates.push({ name: entry.name, meaningTags: entry.meaningTags });
		}
	}

	if (wantFull) {
		candidates.push(...composeFullNames(dataset, query, locale, rng));
	}

	return candidates;
}

/**
 * Select up to `count` names matching the query. Candidates are direct entries
 * plus (when `full` is requested) composed given+family pairs. Existing names are
 * avoided probabilistically per `avoidanceLevel` (0 = never avoid, 5 = always).
 * Selection is randomized (injectable `rng` for deterministic tests) so repeated
 * calls surface varied suggestions rather than a fixed prefix.
 */
export function suggestNames(
	dataset: NameEntry[],
	query: NameQuery,
	existingNames: Set<string>,
	locale: string,
	rng: () => number = Math.random
): SuggestedName[] {
	const count = Math.min(Math.max(query.count ?? DEFAULT_COUNT, 1), MAX_COUNT);
	const avoidance = Math.min(Math.max(query.avoidanceLevel ?? DEFAULT_AVOIDANCE, 0), MAX_AVOIDANCE);
	const rejectProbability = avoidance / MAX_AVOIDANCE;

	const candidates = buildCandidates(dataset, query, locale, rng);

	const seen = new Set<string>();
	const unique = candidates.filter((c) => {
		const key = normalizeName(c.name);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	const results: SuggestedName[] = [];
	for (const candidate of shuffle(unique, rng)) {
		if (results.length >= count) break;
		const collides = existingNames.has(normalizeName(candidate.name));
		if (collides && rng() < rejectProbability) continue;
		results.push(candidate);
	}
	return results;
}
