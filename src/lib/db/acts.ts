import { getDatabase } from './database';

export interface Act {
	id: string;
	storyId: string;
	name: string;
	actNumber: number;
	continuesFromActLineId: string | null;
	createdAt: number;
	updatedAt: number;
}

interface ActRow {
	id: string;
	story_id: string;
	name: string;
	act_number: number;
	continues_from_act_line_id: string | null;
	created_at: number;
	updated_at: number;
}

function rowToAct(row: ActRow): Act {
	return {
		id: row.id,
		storyId: row.story_id,
		name: row.name,
		actNumber: row.act_number,
		continuesFromActLineId: row.continues_from_act_line_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export async function createAct(
	id: string,
	storyId: string,
	name: string,
	actNumber: number,
	continuesFromActLineId: string | null = null
): Promise<Act> {
	const db = getDatabase();
	const now = Date.now();
	await db.execute(
		`INSERT INTO acts (id, story_id, name, act_number, continues_from_act_line_id, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[id, storyId, name, actNumber, continuesFromActLineId, now, now]
	);
	return {
		id,
		storyId,
		name,
		actNumber,
		continuesFromActLineId,
		createdAt: now,
		updatedAt: now
	};
}

export async function getAct(id: string): Promise<Act | null> {
	const db = getDatabase();
	const rows = await db.select<ActRow[]>('SELECT * FROM acts WHERE id = $1', [id]);
	return rows.length > 0 ? rowToAct(rows[0]) : null;
}

export async function getActsForStory(storyId: string): Promise<Act[]> {
	const db = getDatabase();
	const rows = await db.select<ActRow[]>(
		'SELECT * FROM acts WHERE story_id = $1 ORDER BY act_number ASC',
		[storyId]
	);
	return rows.map(rowToAct);
}

export async function getNextActNumber(storyId: string): Promise<number> {
	const db = getDatabase();
	const rows = await db.select<{ max: number | null }[]>(
		'SELECT MAX(act_number) as max FROM acts WHERE story_id = $1',
		[storyId]
	);
	return (rows[0]?.max ?? 0) + 1;
}

export async function updateAct(id: string, name: string): Promise<void> {
	const db = getDatabase();
	const now = Date.now();
	await db.execute(
		'UPDATE acts SET name = $1, updated_at = $2 WHERE id = $3',
		[name, now, id]
	);
}

export async function deleteAct(id: string): Promise<void> {
	const db = getDatabase();
	await db.execute('DELETE FROM acts WHERE id = $1', [id]);
}

export async function getActsContinuingFrom(actLineId: string): Promise<Act[]> {
	const db = getDatabase();
	const rows = await db.select<ActRow[]>(
		'SELECT * FROM acts WHERE continues_from_act_line_id = $1',
		[actLineId]
	);
	return rows.map(rowToAct);
}