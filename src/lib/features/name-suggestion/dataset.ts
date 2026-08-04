import { loadNameFiles } from '$lib/fs/names';
import { log } from '$lib/logging/logger';
import { getNameSuggestionQuotas } from '$lib/stores/settings.svelte';
import { normalizeName } from './engine';
import { parseNameDataset } from './json';
import { applyQuotas, QUOTA_FALLBACK_LOCALE as FALLBACK_LOCALE } from './quota';
import type { NameEntry } from './types';

const LOG_TAG = 'name-suggestion';

async function loadLocale(locale: string): Promise<NameEntry[]> {
	const files = await loadNameFiles(locale);
	const entries: NameEntry[] = [];
	for (const { relativePath, content } of files) {
		const parsed = parseNameDataset(content, (index, reason) => {
			void log.warn(LOG_TAG, `Invalid name entry in ${locale}/names/${relativePath}:${index} — ${reason}`);
		});
		entries.push(...parsed);
	}
	return entries;
}

/** Names appear in multiple culture files; keep the first occurrence so quotas see each name once. */
function dedupEntries(entries: NameEntry[]): NameEntry[] {
	const seen = new Set<string>();
	const unique: NameEntry[] = [];
	for (const entry of entries) {
		const key = normalizeName(entry.name);
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(entry);
	}
	return unique;
}

/**
 * Load the full deduplicated name pool for a locale from the managed config
 * files (`config/<locale>/names/<culture>.json` — user-overridable,
 * with bundled fallback), without quota curation. A locale with no names falls
 * back to `en`. Files are read fresh on each call so user edits take effect
 * without a restart. Used for quota previews that compare active vs total.
 */
export async function getNameDatasetPool(locale: string): Promise<NameEntry[]> {
	const entries = dedupEntries(await loadLocale(locale));
	if (entries.length === 0 && locale !== FALLBACK_LOCALE) return dedupEntries(await loadLocale(FALLBACK_LOCALE));
	return entries;
}

/**
 * Load the name dataset for a locale: the deduplicated pool curated down to
 * the configured quotas via random sampling (injectable `rng` for
 * deterministic tests).
 */
export async function getNameDataset(locale: string, rng: () => number = Math.random): Promise<NameEntry[]> {
	return applyQuotas(await getNameDatasetPool(locale), getNameSuggestionQuotas(), locale, rng);
}
