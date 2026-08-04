import { LocalizedNameFile, registerDefaults, SUPPORTED_LOCALES, type SupportedLocale } from './prompt-loader';
import { registerBundledContent } from './config-manifest';

const nameDefaults: Record<SupportedLocale, Record<string, string>> = {
	en: import.meta.glob('./en/names/*.json', {
		eager: true,
		query: '?raw',
		import: 'default' as const,
	}) as Record<string, string>,
	'zh-Hant-HK': import.meta.glob('./zh-Hant-HK/names/*.json', {
		eager: true,
		query: '?raw',
		import: 'default' as const,
	}) as Record<string, string>,
};

function toRelativePath(globKey: string): string {
	return globKey.replace(/^\.\//, '').replace(/^.*?names\//, '');
}

/** Union of name files (relative to the names dir) across all locales, e.g. `chinese.json`. */
export const NAME_FILES: string[] = Array.from(
	new Set(SUPPORTED_LOCALES.flatMap((locale) => Object.keys(nameDefaults[locale]).map(toRelativePath)))
).sort();

// Locales missing a file that exists in another locale get an empty array so
// every seeded config file is valid JSON and users have a place to add names.
for (const locale of SUPPORTED_LOCALES) {
	for (const relativePath of NAME_FILES) {
		const key = `./${locale}/names/${relativePath}`;
		if (nameDefaults[locale][key] === undefined) nameDefaults[locale][key] = '[]';
	}
}

const nameFileByRel = new Map<string, LocalizedNameFile>();
for (const relativePath of NAME_FILES) {
	nameFileByRel.set(relativePath, new LocalizedNameFile(nameDefaults, relativePath));
}

let registered = false;

/**
 * Register the bundled name files so `ensureAllBaseConfigs()` seeds them to
 * AppData and `syncConfigAssets()` can keep them up to date. Must run before
 * `ensureAllBaseConfigs()`; called explicitly during app initialization.
 * Idempotent.
 */
export function registerNameDefaults(): void {
	if (registered) return;
	registered = true;
	for (const locale of SUPPORTED_LOCALES) {
		for (const relativePath of NAME_FILES) {
			registerBundledContent(`${locale}/names/${relativePath}`, nameDefaults[locale][`./${locale}/names/${relativePath}`]);
		}
	}
	registerDefaults(Array.from(nameFileByRel.values()));
}

export interface NameFileContent {
	relativePath: string;
	content: string;
}

/**
 * Load all name files for a locale, resolving AppData overrides
 * (`config/<locale>/names/<culture>.json` → bundled default). Returns raw file
 * contents; parsing and merging are the caller's responsibility.
 */
export async function loadNameFiles(locale: string): Promise<NameFileContent[]> {
	const results: NameFileContent[] = [];
	for (const relativePath of NAME_FILES) {
		const file = nameFileByRel.get(relativePath);
		if (!file) continue;
		results.push({ relativePath, content: await file.loadForLocale(locale) });
	}
	return results;
}
