import { getDatabase } from './database';
import { deleteAct } from './acts';

export interface Story {
	id: string;
	name: string;
	locale: string;
	createdAt: number;
	updatedAt: number;
}

interface StoryRow {
	id: string;
	name: string;
	locale: string;
	created_at: number;
	updated_at: number;
}

function rowToStory(row: StoryRow): Story {
	return {
		id: row.id,
		name: row.name,
		locale: row.locale,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function createStory(id: string, name: string, locale: string): Promise<Story> {
	const db = getDatabase();
	const now = Date.now();
	await db.execute('INSERT INTO stories (id, name, locale, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)', [
		id,
		name,
		locale,
		now,
		now,
	]);
	return { id, name, locale, createdAt: now, updatedAt: now };
}

export async function getStory(id: string): Promise<Story | null> {
	const db = getDatabase();
	const rows = await db.select<StoryRow[]>('SELECT * FROM stories WHERE id = $1', [id]);
	return rows.length > 0 ? rowToStory(rows[0]) : null;
}

export async function upsertStory(id: string, name: string, locale: string, createdAt: number): Promise<void> {
	const db = getDatabase();
	await db.execute('INSERT OR REPLACE INTO stories (id, name, locale, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)', [
		id,
		name,
		locale,
		createdAt,
		Date.now(),
	]);
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

	const actRows = await db.select<{ id: string }[]>('SELECT id FROM acts WHERE story_id = $1', [id]);
	for (const row of actRows) {
		await deleteAct(row.id);
	}

	await db.execute('DELETE FROM stories WHERE id = $1', [id]);
}
