import {
	readTextFile,
	writeTextFile,
	mkdir,
	exists,
	readDir,
	rename,
	BaseDirectory,
	type DirEntry
} from '@tauri-apps/plugin-fs';
import { SYSTEM_PROMPT_FILE, getDefaultSystemPromptContent } from './system-prompt';
import { log } from '$lib/logging/logger';
import { NARRATION_TEMPLATE_FILE, getDefaultNarrationTemplateContent } from './narration-template';
import * as dbStoryFolders from '$lib/db/story-folders';
import { generateWorld } from '$lib/ai/world-generator';

/**
 * Compute the canonical folder name for a story.
 * Removes characters problematic across Windows/macOS/Linux filesystems
 * while preserving Unicode letters, numbers, spaces, hyphens, underscores.
 */
export function canonicalName(name: string): string {
	// Remove: / \ < > : " | ? * and control characters (0x00-0x1F)
	let sanitized = name.replace(/[/\\<>:"|?*\x00-\x1F]/g, '');
	// Trim trailing spaces and dots (Windows issue)
	sanitized = sanitized.replace(/[\s.]+$/u, '');
	// Trim leading spaces
	sanitized = sanitized.replace(/^\s+/u, '');
	return sanitized;
}

function shortId(id: string): string {
	return id.split('-')[0];
}


async function listAppDataFolders(): Promise<string[]> {
	const entries = await readDir('', { baseDir: BaseDirectory.AppData });
	return entries
		.filter((e: DirEntry) => e.isDirectory)
		.map((e: DirEntry) => e.name);
}

/**
 * Resolve the folder name for a story.
 *
 * Algorithm:
 * 1. Check DB cache → verify folder exists
 * 2. List AppData folders
 * 3. Try exact match on canonical name (no UUID suffix)
 * 4. Try prefix match with " - {shortId}" suffix
 * 5. If no match and no collision → create with canonical name
 * 6. If collision → create with " - {shortId}" suffix
 */
export async function resolveStoryFolder(storyId: string, storyName: string): Promise<string> {
	const canon = canonicalName(storyName);

	// 1. Check DB cache
	const cached = await dbStoryFolders.getStoryFolder(storyId);
	if (cached) {
		const folderExists = await exists(cached, { baseDir: BaseDirectory.AppData });
		if (folderExists) return cached;
		// Stale mapping — remove and re-resolve
		await dbStoryFolders.deleteStoryFolder(storyId);
	}

	// Fallback if canonical name is empty
	if (!canon) {
		const folderName = `story-${shortId(storyId)}`;
		await mkdir(folderName, { baseDir: BaseDirectory.AppData, recursive: true });
		await dbStoryFolders.setStoryFolder(storyId, folderName);
		return folderName;
	}

	// 2. List existing folders
	const folders = await listAppDataFolders();

	// 3. Try exact match (canonical name with no suffix)
	if (folders.includes(canon)) {
		// Check if another story already owns this exact-name folder
		const existingOwner = await dbStoryFolders.getFolderOwner(canon);
		if (!existingOwner) {
			// Unclaimed — claim it
			await dbStoryFolders.setStoryFolder(storyId, canon);
			return canon;
		}
		if (existingOwner === storyId) {
			// Already ours
			await dbStoryFolders.setStoryFolder(storyId, canon);
			return canon;
		}
		// Collision — fall through to UUID suffix
	} else {
		// No exact match — this name is free
		await mkdir(canon, { baseDir: BaseDirectory.AppData, recursive: true });
		await dbStoryFolders.setStoryFolder(storyId, canon);
		return canon;
	}

	// 4. Try prefix match with UUID suffix
	const suffixId = shortId(storyId);
	const suffixedName = `${canon} - ${suffixId}`;
	if (folders.includes(suffixedName)) {
		await dbStoryFolders.setStoryFolder(storyId, suffixedName);
		return suffixedName;
	}

	// 5. Collision exists — create with UUID suffix
	await mkdir(suffixedName, { baseDir: BaseDirectory.AppData, recursive: true });
	await dbStoryFolders.setStoryFolder(storyId, suffixedName);
	return suffixedName;
}

/**
 * Ensure a story folder exists and contains system-prompt.md.
 * Returns the folder name.
 */
export async function ensureStoryPromptFolder(storyId: string, storyName: string): Promise<string> {
	const folderName = await resolveStoryFolder(storyId, storyName);

	const promptPath = `${folderName}/${SYSTEM_PROMPT_FILE}`;
	const promptExists = await exists(promptPath, { baseDir: BaseDirectory.AppData });
	if (!promptExists) {
		const defaultContent = await getDefaultSystemPromptContent();
		await writeTextFile(promptPath, defaultContent, { baseDir: BaseDirectory.AppData });
	}

	return folderName;
}

/**
 * Load the system prompt for a specific story.
 * Ensures the folder and prompt file exist, then returns the content.
 */
export async function loadStorySystemPrompt(storyId: string, storyName: string): Promise<string> {
	await ensureStoryPromptFolder(storyId, storyName);

	const folderName = await dbStoryFolders.getStoryFolder(storyId) ?? canonicalName(storyName);
	const promptPath = `${folderName}/${SYSTEM_PROMPT_FILE}`;

	try {
		return await readTextFile(promptPath, { baseDir: BaseDirectory.AppData });
	} catch {
		return await getDefaultSystemPromptContent();
	}
}

/**
 * Ensure the story folder has a world.md file.
 * If it doesn't exist, generate it from the story's chat history.
 */
export async function ensureWorldFile(storyId: string, storyName: string): Promise<void> {
	const folderName = await dbStoryFolders.getStoryFolder(storyId) ?? await resolveStoryFolder(storyId, storyName);

	const worldPath = `${folderName}/world.md`;
	const worldExists = await exists(worldPath, { baseDir: BaseDirectory.AppData });
	if (worldExists) return;

	try {
		await generateWorld(storyId, folderName);
	} catch (err) {
		await log.error('world', 'Failed to generate world.md', err);
	}
}

/**
 * Ensure a story folder contains narration-template.md.
 */
export async function ensureNarrationTemplateInFolder(storyId: string, storyName: string): Promise<void> {
	const folderName = await resolveStoryFolder(storyId, storyName);

	const templatePath = `${folderName}/${NARRATION_TEMPLATE_FILE}`;
	const templateExists = await exists(templatePath, { baseDir: BaseDirectory.AppData });
	if (!templateExists) {
		const defaultContent = await getDefaultNarrationTemplateContent();
		await writeTextFile(templatePath, defaultContent, { baseDir: BaseDirectory.AppData });
	}
}

/**
 * Load the narration template for a specific story.
 * Ensures the file exists in the story folder, then returns the content.
 */
export async function loadStoryNarrationTemplate(storyId: string, storyName: string): Promise<string> {
	await ensureNarrationTemplateInFolder(storyId, storyName);

	const folderName = await dbStoryFolders.getStoryFolder(storyId) ?? canonicalName(storyName);
	const templatePath = `${folderName}/${NARRATION_TEMPLATE_FILE}`;

	try {
		return await readTextFile(templatePath, { baseDir: BaseDirectory.AppData });
	} catch {
		return await getDefaultNarrationTemplateContent();
	}
}

/**
 * Load the world.md content for a specific story.
 * Returns null if the file doesn't exist.
 */
export async function loadStoryWorldContent(storyId: string, storyName: string): Promise<string | null> {
	const folderName = await dbStoryFolders.getStoryFolder(storyId) ?? await resolveStoryFolder(storyId, storyName);
	const worldPath = `${folderName}/world.md`;
	try {
		const worldExists = await exists(worldPath, { baseDir: BaseDirectory.AppData });
		if (!worldExists) return null;
		return await readTextFile(worldPath, { baseDir: BaseDirectory.AppData });
	} catch {
		return null;
	}
}

/**
 * Rename a story's folder on disk.
 * Computes the new canonical name, handles collisions, renames via Tauri FS,
 * and updates the DB mapping.
 */
export async function renameStoryFolder(storyId: string, newName: string): Promise<string> {
	const oldFolder = await dbStoryFolders.getStoryFolder(storyId);
	if (!oldFolder) return resolveStoryFolder(storyId, newName);

	const canon = canonicalName(newName);

	// Fallback if canonical name is empty
	if (!canon) {
		return oldFolder;
	}

	// Check if the new name collides with an existing folder owned by another story
	const folders = await listAppDataFolders();
	let newFolder = canon;

	if (folders.includes(canon)) {
		const owner = await dbStoryFolders.getFolderOwner(canon);
		if (owner && owner !== storyId) {
			// Collision — use UUID suffix
			newFolder = `${canon} - ${shortId(storyId)}`;
		}
	}

	// Rename on disk if the name actually changed
	if (oldFolder !== newFolder) {
		await rename(oldFolder, newFolder, { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData });
		await dbStoryFolders.setStoryFolder(storyId, newFolder);
	}

	return newFolder;
}
