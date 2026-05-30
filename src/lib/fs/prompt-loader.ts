import { fs } from '$lib/fs/file-system';
import { log } from '$lib/logging/logger';
import { resolveStoryFolder } from './story-folders';
import { syncConfigAssets, loadManifest } from './config-manifest';

/**
 * All locales that have bundled default content.
 * Used by ensureAllBaseConfigs() to seed files for every locale on init.
 */
export const SUPPORTED_LOCALES = ['en', 'zh-Hant-HK'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Active locale determines which locale-scoped config directory to read from.
 * Set by story selection or settings locale.
 */
let activeLocale: string = 'en';

export function getActiveLocale(): string {
	return activeLocale;
}

export function setActiveLocale(locale: string): void {
	activeLocale = locale;
}

export function getPromptTemplatesDir(locale?: string): string {
	return `config/${locale ?? activeLocale}/prompt-templates`;
}

export function getViewTemplatesDir(locale?: string): string {
	return `config/${locale ?? activeLocale}/view-templates`;
}

/**
 * Build a locale-keyed default content map from glob results.
 * Logs a warning if the relativePath isn't found in any locale's glob output.
 */
function buildDefaultsMap(
	globResults: Record<string, Record<string, string>>,
	subDir: string,
	relativePath: string
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const locale of SUPPORTED_LOCALES) {
		const key = `./${locale}/${subDir}/${relativePath}`;
		const content = globResults[locale]?.[key];
		if (content !== undefined) {
			result[locale] = content;
		}
	}
	if (Object.keys(result).length === 0) {
		void log.warn('template-loader', `No bundled default found for '${relativePath}' in any locale under '${subDir}'`);
	}
	return result;
}

/**
 * Base class for locale-scoped template files with bundled defaults.
 * baseDir is resolved dynamically so locale switches take effect.
 *
 * Subclasses provide the subdirectory name and directory resolution function.
 */
export abstract class LocalizedTemplateFile {
	readonly relativePath: string;
	private readonly _defaultContent: Record<string, string>;

	protected abstract getDirForLocale(locale: string): string;

	protected constructor(globResults: Record<string, Record<string, string>>, subDir: string, relativePath: string) {
		this.relativePath = relativePath;
		this._defaultContent = buildDefaultsMap(globResults, subDir, relativePath);
	}

	get baseDir(): string {
		return this.getDirForLocale(activeLocale);
	}

	getDefaultContent(locale: string): string {
		return this._defaultContent[locale] ?? this._defaultContent['en'] ?? '';
	}

	getBaseDirForLocale(locale: string): string {
		return this.getDirForLocale(locale);
	}

	/**
	 * Load this template's content for the active locale.
	 * Ensures the base file exists in AppData, then returns its content.
	 */
	async load(): Promise<string> {
		return loadTemplate(this.baseDir, this.relativePath, this.getDefaultContent(getActiveLocale()));
	}

	/**
	 * Load this template with story-specific override for the active locale.
	 *
	 * Resolution order:
	 * 1. Story-specific override: `<story-folder>/<templatesDir>/<relativePath>`
	 * 2. Base file: `config/<locale>/<templatesDir>/<relativePath>`
	 * 3. Bundled default (in-memory)
	 */
	async loadForStory(storyId: string, storyName: string): Promise<string> {
		return loadWithOverride(this.baseDir, storyId, storyName, this.relativePath, this.getDefaultContent(getActiveLocale()));
	}
}

export class LocalizedPromptFile extends LocalizedTemplateFile {
	constructor(globResults: Record<string, Record<string, string>>, relativePath: string) {
		super(globResults, 'prompts', relativePath);
	}
	protected getDirForLocale(locale: string): string {
		return getPromptTemplatesDir(locale);
	}
}

export class LocalizedViewTemplateFile extends LocalizedTemplateFile {
	constructor(globResults: Record<string, Record<string, string>>, relativePath: string) {
		super(globResults, 'view-templates', relativePath);
	}
	protected getDirForLocale(locale: string): string {
		return getViewTemplatesDir(locale);
	}
}

/**
 * Registry of all template files and their bundled defaults.
 * Populated by registerDefaults(), used by ensureAllBaseConfigs().
 */
let defaultsRegistry: LocalizedTemplateFile[] = [];

/**
 * Register templates so ensureAllBaseConfigs() can create them on launch.
 */
export function registerDefaults(entries: LocalizedTemplateFile[]): void {
	defaultsRegistry = defaultsRegistry.concat(entries);
}

/**
 * Ensure a single base template file exists in AppData.
 * Creates the file from bundled defaults if it doesn't exist.
 */
async function ensureBaseFileExists(baseDir: string, relativePath: string, defaultContent: string): Promise<void> {
	const fullPath = `${baseDir}/${relativePath}`;
	const fileExists = await fs.exists(fullPath);
	if (!fileExists) {
		await fs.writeTextFileEnsuringDir(fullPath, defaultContent);
	}
}

/**
 * Ensure a base template file exists in AppData and return its content.
 * Creates the file from bundled defaults if it doesn't exist.
 */
async function ensureAndLoadBase(baseDir: string, relativePath: string, defaultContent: string): Promise<string> {
	await ensureBaseFileExists(baseDir, relativePath, defaultContent);
	const fullPath = `${baseDir}/${relativePath}`;
	return await fs.readTextFile(fullPath);
}

/**
 * Load a template with optional story-specific override.
 *
 * Resolution order:
 * 1. Story-specific override: `<story-folder>/<templatesDir>/<relativePath>`
 * 2. Base file: `config/<locale>/<templatesDir>/<relativePath>`
 * 3. Bundled default (in-memory)
 */
async function loadWithOverride(
	baseDir: string,
	storyId: string,
	storyName: string,
	relativePath: string,
	defaultContent: string
): Promise<string> {
	const templatesDir = baseDir.split('/').pop() ?? 'templates';

	try {
		const storyFolder = await resolveStoryFolder(storyId, storyName);
		const storyPath = `${storyFolder}/${templatesDir}/${relativePath}`;
		const storyContent = await fs.readTextFileIfExists(storyPath);
		if (storyContent) {
			return storyContent;
		}
	} catch (err) {
		await log.debug('template-loader', `Error checking story override at ${relativePath}: ${err}`);
	}

	return ensureAndLoadBase(baseDir, relativePath, defaultContent);
}

/**
 * Load a global template (no story override).
 * Ensures the base file exists in AppData, then returns its content.
 */
async function loadTemplate(baseDir: string, relativePath: string, defaultContent: string): Promise<string> {
	try {
		return await ensureAndLoadBase(baseDir, relativePath, defaultContent);
	} catch (err) {
		await log.warn('template-loader', `Failed to load template at ${baseDir}/${relativePath}: ${err}`);
		return defaultContent;
	}
}

/**
 * Ensure all registered base config files exist in AppData for ALL supported locales.
 * Creates files from bundled defaults if they don't exist.
 * Called during app initialization to ensure configs are available upfront.
 */
export async function ensureAllBaseConfigs(): Promise<void> {
	if (defaultsRegistry.length === 0) {
		await log.warn('template-loader', 'No defaults registered - ensureAllBaseConfigs has no effect');
		return;
	}

	const tombstonePaths = new Set<string>();
	try {
		const manifest = loadManifest();
		for (const [configPath, entry] of manifest) {
			if (entry.hash === null) {
				tombstonePaths.add(configPath);
			}
		}
	} catch (err) {
		void log.warn('template-loader', `Failed to load manifest for tombstone filtering: ${err}`);
	}

	const results = await Promise.allSettled(
		SUPPORTED_LOCALES.flatMap((locale) =>
			defaultsRegistry.map(async (entry) => {
				try {
					const baseDir = entry.getBaseDirForLocale(locale);
					const defaultContent = entry.getDefaultContent(locale);
					const rawPath = `${baseDir}/${entry.relativePath}`;
					const configPath = rawPath.startsWith('config/') ? rawPath.slice('config/'.length) : rawPath;
					if (tombstonePaths.has(configPath)) {
						return { relativePath: entry.relativePath, locale, success: true, skipped: true };
					}
					await ensureBaseFileExists(baseDir, entry.relativePath, defaultContent);
					return { relativePath: entry.relativePath, locale, success: true };
				} catch (err) {
					await log.error('template-loader', `Failed to ensure base config at ${entry.relativePath} for ${locale}: ${err}`);
					return { relativePath: entry.relativePath, locale, success: false, error: err };
				}
			})
		)
	);

	const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
	if (failed.length > 0) {
		await log.warn('template-loader', `${failed.length} of ${results.length} base configs failed to ensure`);
	}

	await syncConfigAssets();
}
