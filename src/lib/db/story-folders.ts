import { getDatabase } from './database';

interface StoryFolder {
	story_id: string;
	folder_name: string;
	created_at: number;
}

export async function getStoryFolder(storyId: string): Promise<string | null> {
	const db = getDatabase();
	const result = await db.select<StoryFolder[]>('SELECT folder_name FROM story_folders WHERE story_id = $1', [storyId]);
	return result.length > 0 ? result[0].folder_name : null;
}

export async function getFolderOwner(folderName: string): Promise<string | null> {
	const db = getDatabase();
	const result = await db.select<StoryFolder[]>('SELECT story_id FROM story_folders WHERE folder_name = $1', [folderName]);
	return result.length > 0 ? result[0].story_id : null;
}

export async function setStoryFolder(storyId: string, folderName: string): Promise<void> {
	const db = getDatabase();
	await db.execute(
		'INSERT INTO story_folders (story_id, folder_name, created_at) VALUES ($1, $2, $3) ON CONFLICT(story_id) DO UPDATE SET folder_name = $2',
		[storyId, folderName, Date.now()]
	);
}

export async function deleteStoryFolder(storyId: string): Promise<void> {
	const db = getDatabase();
	await db.execute('DELETE FROM story_folders WHERE story_id = $1', [storyId]);
}

export async function getAllFolderNames(): Promise<string[]> {
	const db = getDatabase();
	const result = await db.select<StoryFolder[]>('SELECT folder_name FROM story_folders');
	return result.map((r) => r.folder_name);
}
