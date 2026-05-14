import { readTextFile, writeTextFile, mkdir, exists, BaseDirectory } from '@tauri-apps/plugin-fs';
import yaml from 'js-yaml';
import { log } from '$lib/logging/logger';
import { resolveStoryFolder } from './story-folders';

const LOCALE_STRINGS_DIR = 'config/locale-strings';

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
		this.baseDir = config.baseDir ?? LOCALE_STRINGS_DIR;
	}

	async load(): Promise<Record<string, unknown>> {
		return loadLocaleStringsFile(this.baseDir, this.locale, this.defaultContent);
	}

	async loadForStory(storyFolder: string): Promise<Record<string, unknown>> {
		return loadLocaleStringsWithOverride(this.baseDir, storyFolder, this.locale, this.defaultContent);
	}
}

let defaultsRegistry: LocaleStringBundle[] = [];

export function registerLocaleStringDefaults(entries: LocaleStringBundle[]): void {
	defaultsRegistry = defaultsRegistry.concat(entries);
}

async function ensureDirForPath(baseDir: string, relativePath: string): Promise<void> {
	const fullPath = `${baseDir}/${relativePath}`;
	const lastSlashIndex = fullPath.lastIndexOf('/');
	const dir = lastSlashIndex > 0 ? fullPath.substring(0, lastSlashIndex) : baseDir;
	await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true });
}

async function ensureBaseFileExists(baseDir: string, fileName: string, defaultContent: string): Promise<void> {
	await ensureDirForPath(baseDir, fileName);
	const fullPath = `${baseDir}/${fileName}`;
	const fileExists = await exists(fullPath, { baseDir: BaseDirectory.AppData });
	if (!fileExists) {
		await writeTextFile(fullPath, defaultContent, { baseDir: BaseDirectory.AppData });
	}
}

async function ensureAndLoadBase(baseDir: string, fileName: string, defaultContent: string): Promise<Record<string, unknown>> {
	await ensureBaseFileExists(baseDir, fileName, defaultContent);
	const fullPath = `${baseDir}/${fileName}`;
	const content = await readTextFile(fullPath, { baseDir: BaseDirectory.AppData });
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

async function loadLocaleStringsFile(baseDir: string, locale: string, defaultContent: string): Promise<Record<string, unknown>> {
	try {
		return await ensureAndLoadBase(baseDir, `${locale}.yaml`, defaultContent);
	} catch (err) {
		await log.warn('locale-string-loader', `Failed to load locale strings at ${baseDir}/${locale}.yaml: ${err}`);
		return yaml.load(defaultContent) as Record<string, unknown>;
	}
}

async function loadLocaleStringsWithOverride(
	baseDir: string,
	storyFolder: string,
	locale: string,
	defaultContent: string
): Promise<Record<string, unknown>> {
	const storyPath = `${storyFolder}/locale-strings/${locale}.yaml`;

	try {
		const storyFileExists = await exists(storyPath, { baseDir: BaseDirectory.AppData });
		if (storyFileExists) {
			const storyContent = await readTextFile(storyPath, { baseDir: BaseDirectory.AppData });
			const storyData = yaml.load(storyContent) as Record<string, unknown>;
			const baseData = await ensureAndLoadBase(baseDir, `${locale}.yaml`, defaultContent);
			return deepMerge(baseData, storyData);
		}
	} catch (err) {
		await log.debug('locale-string-loader', `Error checking story override at ${storyPath}: ${err}`);
	}

	return loadLocaleStringsFile(baseDir, locale, defaultContent);
}

export async function ensureAllLocaleStringConfigs(): Promise<void> {
	if (defaultsRegistry.length === 0) {
		await log.warn('locale-string-loader', 'No locale string defaults registered - ensureAllLocaleStringConfigs has no effect');
		return;
	}

	const results = await Promise.allSettled(
		defaultsRegistry.map(async (entry) => {
			try {
				await ensureBaseFileExists(entry.baseDir, `${entry.locale}.yaml`, entry.defaultContent);
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
