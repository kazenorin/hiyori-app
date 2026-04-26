import { readTextFile, writeTextFile, mkdir, exists, BaseDirectory } from '@tauri-apps/plugin-fs';
import { log } from '$lib/logging/logger';
import { resolveStoryFolder } from './story-folders';

/**
 * Base directories for template types in AppData.
 */
const PROMPT_TEMPLATES_DIR = 'config/prompt-templates';
const VIEW_TEMPLATES_DIR = 'config/view-templates';

/**
 * Configuration entry for a template file.
 */
interface TemplateConfig {
	relativePath: string;
	defaultContent: string;
	baseDir?: string;
}

/**
 * Represents a template file with its path, base directory, and default content.
 * Provides a load() method to load the template content.
 *
 * Used for both prompt templates and view templates.
 */
export class Prompt {
	readonly relativePath: string;
	readonly defaultContent: string;
	readonly baseDir: string;

	constructor(config: TemplateConfig) {
		this.relativePath = config.relativePath;
		this.defaultContent = config.defaultContent;
		this.baseDir = config.baseDir ?? PROMPT_TEMPLATES_DIR;
	}

	/**
	 * Load this template's content.
	 * Ensures the base file exists in AppData, then returns its content.
	 */
	async load(): Promise<string> {
		return loadTemplate(this.baseDir, this.relativePath, this.defaultContent);
	}
}

/**
 * Registry of all template files and their bundled defaults.
 * Populated by registerDefaults(), used by ensureAllBaseConfigs().
 */
let defaultsRegistry: Prompt[] = [];

/**
 * Register templates so ensureAllBaseConfigs() can create them on launch.
 */
export function registerDefaults(entries: Prompt[]): void {
	defaultsRegistry = defaultsRegistry.concat(entries);
}

/**
 * Ensure the directory for a relative path exists.
 */
async function ensureDirForPath(baseDir: string, relativePath: string): Promise<void> {
	const fullPath = `${baseDir}/${relativePath}`;
	const lastSlashIndex = fullPath.lastIndexOf('/');
	const dir = lastSlashIndex > 0 ? fullPath.substring(0, lastSlashIndex) : baseDir;
	await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true });
}

/**
 * Ensure a single base template file exists in AppData.
 * Creates the file from bundled defaults if it doesn't exist.
 * Does not return the content - use ensureAndLoadBase for that.
 */
async function ensureBaseFileExists(baseDir: string, relativePath: string, defaultContent: string): Promise<void> {
	const fullPath = `${baseDir}/${relativePath}`;
	await ensureDirForPath(baseDir, relativePath);

	const fileExists = await exists(fullPath, { baseDir: BaseDirectory.AppData });
	if (!fileExists) {
		await writeTextFile(fullPath, defaultContent, { baseDir: BaseDirectory.AppData });
	}
}

/**
 * Ensure a base template file exists in AppData and return its content.
 * Creates the file from bundled defaults if it doesn't exist.
 */
async function ensureAndLoadBase(baseDir: string, relativePath: string, defaultContent: string): Promise<string> {
	await ensureBaseFileExists(baseDir, relativePath, defaultContent);
	const fullPath = `${baseDir}/${relativePath}`;
	return await readTextFile(fullPath, { baseDir: BaseDirectory.AppData });
}

/**
 * Load a template with optional story-specific override.
 *
 * Resolution order:
 * 1. Story-specific override: `<story-folder>/<templatesDir>/<relativePath>`
 * 2. Base file: `config/<templatesDir>/<relativePath>`
 * 3. Bundled default (in-memory)
 */
async function loadWithOverride(baseDir: string, storyFolder: string, relativePath: string, defaultContent: string): Promise<string> {
	const templatesDir = baseDir.split('/').pop() ?? 'templates';
	const storyPath = `${storyFolder}/${templatesDir}/${relativePath}`;

	try {
		const storyFileExists = await exists(storyPath, { baseDir: BaseDirectory.AppData });
		if (storyFileExists) {
			return await readTextFile(storyPath, { baseDir: BaseDirectory.AppData });
		}
	} catch (err) {
		await log.debug('template-loader', `Error checking story override at ${storyPath}: ${err}`);
	}

	return ensureAndLoadBase(baseDir, relativePath, defaultContent);
}

/**
 * Load a global template (no story override).
 * Ensures the base file exists in AppData, then returns its content.
 */
export async function loadTemplate(baseDir: string, relativePath: string, defaultContent: string): Promise<string> {
	try {
		return await ensureAndLoadBase(baseDir, relativePath, defaultContent);
	} catch (err) {
		await log.warn('template-loader', `Failed to load template at ${baseDir}/${relativePath}: ${err}`);
		return defaultContent;
	}
}

/**
 * Load a prompt template (backward-compatible shorthand).
 */
export async function loadPrompt(relativePath: string, defaultContent: string): Promise<string> {
	return loadTemplate(PROMPT_TEMPLATES_DIR, relativePath, defaultContent);
}

/**
 * Load a view template.
 */
export async function loadViewTemplate(relativePath: string, defaultContent: string): Promise<string> {
	return loadTemplate(VIEW_TEMPLATES_DIR, relativePath, defaultContent);
}

/**
 * Load a prompt template for a specific story, with fallback to the global base file.
 *
 * @param storyId - The story ID for folder resolution
 * @param storyName - The story name for folder resolution
 * @param relativePath - Path relative to prompt-templates/ (e.g. "world/world-template.md")
 * @param defaultContent - Bundled default content
 */
export async function loadPromptForStory(
	storyId: string,
	storyName: string,
	relativePath: string,
	defaultContent: string
): Promise<string> {
	try {
		const storyFolder = await resolveStoryFolder(storyId, storyName);
		return await loadWithOverride(PROMPT_TEMPLATES_DIR, storyFolder, relativePath, defaultContent);
	} catch (err) {
		await log.warn('template-loader', `Failed to load story prompt at ${relativePath}: ${err}`);
		return defaultContent;
	}
}

/**
 * Load a view template for a specific story, with fallback to the global base file.
 */
export async function loadViewTemplateForStory(
	storyId: string,
	storyName: string,
	relativePath: string,
	defaultContent: string
): Promise<string> {
	try {
		const storyFolder = await resolveStoryFolder(storyId, storyName);
		return await loadWithOverride(VIEW_TEMPLATES_DIR, storyFolder, relativePath, defaultContent);
	} catch (err) {
		await log.warn('template-loader', `Failed to load story view template at ${relativePath}: ${err}`);
		return defaultContent;
	}
}

/**
 * Ensure all registered base config files exist in AppData.
 * Creates files from bundled defaults if they don't exist.
 * Called during app initialization to ensure configs are available upfront.
 *
 * Individual file failures are logged but don't block other files.
 * If the registry is empty, a warning is logged.
 */
export async function ensureAllBaseConfigs(): Promise<void> {
	if (defaultsRegistry.length === 0) {
		await log.warn('template-loader', 'No defaults registered - ensureAllBaseConfigs has no effect');
		return;
	}

	const results = await Promise.allSettled(
		defaultsRegistry.map(async (entry) => {
			try {
				await ensureBaseFileExists(entry.baseDir, entry.relativePath, entry.defaultContent);
				return { relativePath: entry.relativePath, success: true };
			} catch (err) {
				await log.error('template-loader', `Failed to ensure base config at ${entry.relativePath}: ${err}`);
				return { relativePath: entry.relativePath, success: false, error: err };
			}
		})
	);

	const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
	if (failed.length > 0) {
		await log.warn('template-loader', `${failed.length} of ${results.length} base configs failed to ensure`);
	}
}
