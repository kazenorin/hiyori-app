import { readTextFile, writeTextFile, mkdir, exists, BaseDirectory } from '@tauri-apps/plugin-fs';
import { log } from '$lib/logging/logger';
import { resolveStoryFolder } from './story-folders';

/**
 * Base directory for prompt templates in AppData.
 * All prompt files are stored under this path with subdirectory structure.
 */
const PROMPT_TEMPLATES_DIR = 'config/prompt-templates';

/**
 * Configuration entry for a prompt template.
 */
interface PromptConfig {
	relativePath: string;
	defaultContent: string;
}

/**
 * Represents a prompt template with its path and default content.
 * Provides a load() method to load the prompt content.
 */
export class Prompt {
	readonly relativePath: string;
	readonly defaultContent: string;

	constructor(config: PromptConfig) {
		this.relativePath = config.relativePath;
		this.defaultContent = config.defaultContent;
	}

	/**
	 * Load this prompt's content.
	 * Ensures the base file exists in AppData, then returns its content.
	 */
	async load(): Promise<string> {
		return loadPrompt(this.relativePath, this.defaultContent);
	}
}

/**
 * Registry of all prompt template files and their bundled defaults.
 * Populated by registerDefaults(), used by ensureAllBaseConfigs().
 */
let defaultsRegistry: Prompt[] = [];

/**
 * Register prompts so ensureAllBaseConfigs() can create them on launch.
 */
export function registerDefaults(entries: Prompt[]): void {
	defaultsRegistry = defaultsRegistry.concat(entries);
}

/**
 * Ensure the directory for a relative path exists.
 */
async function ensureDirForPath(fullPath: string): Promise<void> {
	const lastSlashIndex = fullPath.lastIndexOf('/');
	const dir = lastSlashIndex > 0 ? fullPath.substring(0, lastSlashIndex) : PROMPT_TEMPLATES_DIR;
	await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true });
}

/**
 * Ensure a single base prompt file exists in AppData.
 * Creates the file from bundled defaults if it doesn't exist.
 * Does not return the content - use ensureAndLoadBase for that.
 */
async function ensureBaseFileExists(relativePath: string, defaultContent: string): Promise<void> {
	const fullPath = `${PROMPT_TEMPLATES_DIR}/${relativePath}`;
	await ensureDirForPath(fullPath);

	const fileExists = await exists(fullPath, { baseDir: BaseDirectory.AppData });
	if (!fileExists) {
		await writeTextFile(fullPath, defaultContent, { baseDir: BaseDirectory.AppData });
	}
}

/**
 * Ensure a base prompt file exists in AppData and return its content.
 * Creates the file from bundled defaults if it doesn't exist.
 */
async function ensureAndLoadBase(relativePath: string, defaultContent: string): Promise<string> {
	await ensureBaseFileExists(relativePath, defaultContent);
	const fullPath = `${PROMPT_TEMPLATES_DIR}/${relativePath}`;
	return await readTextFile(fullPath, { baseDir: BaseDirectory.AppData });
}

/**
 * Load a prompt with optional story-specific override.
 *
 * Resolution order:
 * 1. Story-specific override: `<story-folder>/prompt-templates/<relativePath>`
 * 2. Base file: `config/prompt-templates/<relativePath>`
 * 3. Bundled default (in-memory)
 */
async function loadWithOverride(storyFolder: string, relativePath: string, defaultContent: string): Promise<string> {
	const storyPath = `${storyFolder}/prompt-templates/${relativePath}`;

	try {
		const storyFileExists = await exists(storyPath, { baseDir: BaseDirectory.AppData });
		if (storyFileExists) {
			return await readTextFile(storyPath, { baseDir: BaseDirectory.AppData });
		}
	} catch (err) {
		await log.debug('prompt-loader', `Error checking story override at ${storyPath}: ${err}`);
	}

	return ensureAndLoadBase(relativePath, defaultContent);
}

/**
 * Load a global prompt template (no story override).
 * Ensures the base file exists in AppData, then returns its content.
 */
export async function loadPrompt(relativePath: string, defaultContent: string): Promise<string> {
	try {
		return await ensureAndLoadBase(relativePath, defaultContent);
	} catch (err) {
		await log.warn('prompt-loader', `Failed to load prompt at ${relativePath}: ${err}`);
		return defaultContent;
	}
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
		return await loadWithOverride(storyFolder, relativePath, defaultContent);
	} catch (err) {
		await log.warn('prompt-loader', `Failed to load story prompt at ${relativePath}: ${err}`);
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
		await log.warn('prompt-loader', 'No defaults registered - ensureAllBaseConfigs has no effect');
		return;
	}

	const results = await Promise.allSettled(
		defaultsRegistry.map(async (entry) => {
			try {
				await ensureBaseFileExists(entry.relativePath, entry.defaultContent);
				return { relativePath: entry.relativePath, success: true };
			} catch (err) {
				await log.error('prompt-loader', `Failed to ensure base config at ${entry.relativePath}: ${err}`);
				return { relativePath: entry.relativePath, success: false, error: err };
			}
		})
	);

	const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
	if (failed.length > 0) {
		await log.warn('prompt-loader', `${failed.length} of ${results.length} base configs failed to ensure`);
	}
}
