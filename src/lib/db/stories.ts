import { getDatabase } from './database';

export interface Story {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
}

interface StoryRow {
	id: string;
	name: string;
	created_at: number;
	updated_at: number;
}

function rowToStory(row: StoryRow): Story {
	return {
		id: row.id,
		name: row.name,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function createStory(id: string, name: string): Promise<Story> {
	const db = getDatabase();
	const now = Date.now();
	await db.execute('INSERT INTO stories (id, name, created_at, updated_at) VALUES ($1, $2, $3, $4)', [
		id,
		name,
		now,
		now,
	]);
	return { id, name, createdAt: now, updatedAt: now };
}

export async function getStory(id: string): Promise<Story | null> {
	const db = getDatabase();
	const rows = await db.select<StoryRow[]>('SELECT * FROM stories WHERE id = $1', [id]);
	return rows.length > 0 ? rowToStory(rows[0]) : null;
}

export async function getAllStories(): Promise<Story[]> {
	const db = getDatabase();
	const rows = await db.select<StoryRow[]>('SELECT * FROM stories ORDER BY updated_at DESC');
	return rows.map(rowToStory);
}

export async function updateStory(id: string, name: string): Promise<void> {
	const db = getDatabase();
	const now = Date.now();
	await db.execute('UPDATE stories SET name = $1, updated_at = $2 WHERE id = $3', [name, now, id]);
}

export async function deleteStory(id: string): Promise<void> {
	const db = getDatabase();
	await db.execute('DELETE FROM stories WHERE id = $1', [id]);
}
