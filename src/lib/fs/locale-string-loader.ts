import { fs } from '$lib/fs/file-system';
import yaml from 'js-yaml';
import { log } from '$lib/logging/logger';

const LOCALE_STRINGS_FILENAME = 'locale-strings.yaml';

export interface LocaleStringConfig {
	locale: string;
	defaultContent: string;
	baseDir?: string;
}

export class LocaleStringBundle {
	readonly locale: string;
	readonly defaultContent: string;
	readonly baseDir: string;

	constructor(config: LocaleStringConfig) {
		this.locale = config.locale;
		this.defaultContent = config.defaultContent;
		this.baseDir = config.baseDir ?? `config/${config.locale}`;
	}

	async load(): Promise<Record<string, unknown>> {
		return loadLocaleStringsFile(this.baseDir, LOCALE_STRINGS_FILENAME, this.defaultContent);
	}

	async loadForStory(storyFolder: string): Promise<Record<string, unknown>> {
		return loadLocaleStringsWithOverride(this.baseDir, LOCALE_STRINGS_FILENAME, storyFolder, this.defaultContent);
	}
}

let defaultsRegistry: LocaleStringBundle[] = [];

export function registerLocaleStringDefaults(entries: LocaleStringBundle[]): void {
	defaultsRegistry = defaultsRegistry.concat(entries);
}

async function ensureBaseFileExists(baseDir: string, fileName: string, defaultContent: string): Promise<void> {
	const fullPath = `${baseDir}/${fileName}`;
	const fileExists = await fs.exists(fullPath);
	if (!fileExists) {
		await fs.writeTextFileEnsuringDir(fullPath, defaultContent);
	}
}

async function ensureAndLoadBase(baseDir: string, fileName: string, defaultContent: string): Promise<Record<string, unknown>> {
	await ensureBaseFileExists(baseDir, fileName, defaultContent);
	const fullPath = `${baseDir}/${fileName}`;
	const content = await fs.readTextFile(fullPath);
	return yaml.load(content) as Record<string, unknown>;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
	const result = { ...target };
	for (const key of Object.keys(source)) {
		if (
			key in result &&
			typeof result[key] === 'object' &&
			result[key] !== null &&
			!Array.isArray(result[key]) &&
			typeof source[key] === 'object' &&
			source[key] !== null &&
			!Array.isArray(source[key])
		) {
			result[key] = deepMerge(result[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
		} else {
			result[key] = source[key];
		}
	}
	return result;
}

function flattenToPaths(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(obj)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === 'string') {
			result[path] = value;
		} else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
			Object.assign(result, flattenToPaths(value as Record<string, unknown>, path));
		}
	}
	return result;
}

async function loadLocaleStringsFile(baseDir: string, fileName: string, defaultContent: string): Promise<Record<string, unknown>> {
	try {
		return await ensureAndLoadBase(baseDir, fileName, defaultContent);
	} catch (err) {
		await log.warn('locale-string-loader', `Failed to load locale strings at ${baseDir}/${fileName}: ${err}`);
		return yaml.load(defaultContent) as Record<string, unknown>;
	}
}

async function loadLocaleStringsWithOverride(
	baseDir: string,
	fileName: string,
	storyFolder: string,
	defaultContent: string
): Promise<Record<string, unknown>> {
	const storyPath = `${storyFolder}/${fileName}`;

	try {
		const storyContent = await fs.readTextFileIfExists(storyPath);
		if (storyContent) {
			const storyData = yaml.load(storyContent) as Record<string, unknown>;
			const baseData = await ensureAndLoadBase(baseDir, fileName, defaultContent);
			return deepMerge(baseData, storyData);
		}
	} catch (err) {
		await log.debug('locale-string-loader', `Error checking story override at ${storyPath}: ${err}`);
	}

	return loadLocaleStringsFile(baseDir, fileName, defaultContent);
}

export async function ensureAllLocaleStringConfigs(): Promise<void> {
	if (defaultsRegistry.length === 0) {
		await log.warn('locale-string-loader', 'No locale string defaults registered - ensureAllLocaleStringConfigs has no effect');
		return;
	}

	const results = await Promise.allSettled(
		defaultsRegistry.map(async (entry) => {
			try {
				await ensureBaseFileExists(entry.baseDir, LOCALE_STRINGS_FILENAME, entry.defaultContent);
				return { locale: entry.locale, success: true };
			} catch (err) {
				await log.error('locale-string-loader', `Failed to ensure locale string config for ${entry.locale}: ${err}`);
				return { locale: entry.locale, success: false, error: err };
			}
		})
	);

	const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
	if (failed.length > 0) {
		await log.warn('locale-string-loader', `${failed.length} of ${results.length} locale string configs failed to ensure`);
	}
}

export { flattenToPaths };
