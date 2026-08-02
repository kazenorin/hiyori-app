import { loadNameFiles } from '$lib/fs/names';
import { log } from '$lib/logging/logger';
import { parseNameDataset } from './csv';
import type { NameEntry } from './types';

const LOG_TAG = 'name-suggestion';
const FALLBACK_LOCALE = 'en';

async function loadLocale(locale: string): Promise<NameEntry[]> {
	const files = await loadNameFiles(locale);
	const entries: NameEntry[] = [];
	for (const { relativePath, content } of files) {
		const parsed = parseNameDataset(content, (line, reason) => {
			void log.warn(LOG_TAG, `Invalid name row in ${locale}/names/${relativePath}:${line} — ${reason}`);
		});
		entries.push(...parsed);
	}
	return entries;
}

/**
 * Load the name dataset for a locale from the managed config files
 * (`config/<locale>/names/*.csv` — user-overridable, with bundled fallback).
 * A locale with no names falls back to `en`. Files are read fresh on each call
 * so user edits take effect without a restart.
 */
export async function getNameDataset(locale: string): Promise<NameEntry[]> {
	const entries = await loadLocale(locale);
	if (entries.length === 0 && locale !== FALLBACK_LOCALE) {
		return loadLocale(FALLBACK_LOCALE);
	}
	return entries;
}
