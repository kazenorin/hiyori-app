import { LocalizedNameFile, registerDefaults, SUPPORTED_LOCALES, type SupportedLocale } from './prompt-loader';
import { registerBundledContent } from './config-manifest';
import enMasculine from './en/names/masculine.csv?raw';
import enFeminine from './en/names/feminine.csv?raw';
import enNeutral from './en/names/neutral.csv?raw';
import zhMasculine from './zh-Hant-HK/names/masculine.csv?raw';
import zhFeminine from './zh-Hant-HK/names/feminine.csv?raw';
import zhNeutral from './zh-Hant-HK/names/neutral.csv?raw';

/** The fixed set of name files loaded and merged per locale. */
export const NAME_FILES = ['masculine.csv', 'feminine.csv', 'neutral.csv'] as const;

const nameDefaults: Record<SupportedLocale, Record<string, string>> = {
	en: {
		'./en/names/masculine.csv': enMasculine,
		'./en/names/feminine.csv': enFeminine,
		'./en/names/neutral.csv': enNeutral,
	},
	'zh-Hant-HK': {
		'./zh-Hant-HK/names/masculine.csv': zhMasculine,
		'./zh-Hant-HK/names/feminine.csv': zhFeminine,
		'./zh-Hant-HK/names/neutral.csv': zhNeutral,
	},
};

export interface NameFileContent {
	relativePath: string;
	content: string;
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
	for (const relativePath of NAME_FILES) {
		for (const locale of SUPPORTED_LOCALES) {
			registerBundledContent(`${locale}/names/${relativePath}`, nameDefaults[locale][`./${locale}/names/${relativePath}`]);
		}
	}
	registerDefaults(Array.from(nameFileByRel.values()));
}

/**
 * Load the fixed name files for a locale, resolving AppData overrides
 * (`config/<locale>/names/<file>` → bundled default). Returns raw file contents;
 * parsing and merging are the caller's responsibility.
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
