import { readTextFile, mkdir, exists, readDir, rename, BaseDirectory, type DirEntry } from '@tauri-apps/plugin-fs';
import * as dbStoryFolders from '$lib/db/story-folders';
import { generateWorld } from '$lib/ai/world-generator';
import { log } from '$lib/logging/logger';

/**
 * Compute the canonical folder name for a story.
 * Removes characters problematic across Windows/macOS/Linux filesystems
 * while preserving Unicode letters, numbers, spaces, hyphens, underscores.
 */
export function canonicalName(name: string): string {
	// Remove: / \ < > : " | ? * and control characters (0x00-0x1F)
	// eslint-disable-next-line no-control-regex
	let sanitized = name.replace(/[/\\<>:"|?*\u0000-\u001F]/gu, '');
	// Trim trailing spaces and dots (Windows issue)
	sanitized = sanitized.replace(/[\s.]+$/u, '');
	// Trim leading spaces
	sanitized = sanitized.replace(/^\s+/u, '');
	return sanitized;
}

function shortId(id: string): string {
	return id.split('-')[0];
}

/**
 * Derive a safe story name, falling back to a short UUID-based name
 * when the canonical name would be empty.
 */
export function deriveStoryName(name: string, id: string): string {
	const canon = canonicalName(name);
	return canon || `story-${shortId(id)}`;
}

async function listAppDataFolders(): Promise<string[]> {
	const entries = await readDir('', { baseDir: BaseDirectory.AppData });
	return entries.filter((e: DirEntry) => e.isDirectory).map((e: DirEntry) => e.name);
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
 * Ensure the story folder has a world.md file.
 * If it doesn't exist, generate it from the story's chat history.
 */
export async function ensureWorldFile(storyId: string, storyName: string): Promise<void> {
	const folderName = (await dbStoryFolders.getStoryFolder(storyId)) ?? (await resolveStoryFolder(storyId, storyName));

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
 * Load the world.md content for a specific story.
 * Returns null if the file doesn't exist.
 */
export async function loadStoryWorldContent(storyId: string, storyName?: string): Promise<string | null> {
	const folder = await dbStoryFolders.getStoryFolder(storyId);
	if (!folder && !storyName) return null;

	const folderName = folder ?? (await resolveStoryFolder(storyId, storyName!));
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
		await rename(oldFolder, newFolder, {
			oldPathBaseDir: BaseDirectory.AppData,
			newPathBaseDir: BaseDirectory.AppData,
		});
		await dbStoryFolders.setStoryFolder(storyId, newFolder);
	}

	return newFolder;
}
