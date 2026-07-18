import { getDatabase } from './database';
import { deleteActLine, getActLine } from './act-lines';

export interface Act {
	id: string;
	storyId: string;
	name: string;
	actNumber: number;
	continuesFromActLineId: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface ActChainEntry {
	actLineId: string;
	actNumber: number;
	isMainLine: boolean;
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
		updatedAt: row.updated_at,
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
		updatedAt: now,
	};
}

export async function upsertAct(act: Act): Promise<void> {
	const db = getDatabase();
	await db.execute(
		`INSERT OR REPLACE INTO acts (id, story_id, name, act_number, continues_from_act_line_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[act.id, act.storyId, act.name, act.actNumber, act.continuesFromActLineId, act.createdAt, act.updatedAt]
	);
}

export async function insertAct(act: Act): Promise<void> {
	const db = getDatabase();
	await db.execute(
		`INSERT INTO acts (id, story_id, name, act_number, continues_from_act_line_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[act.id, act.storyId, act.name, act.actNumber, act.continuesFromActLineId, act.createdAt, act.updatedAt]
	);
}

export async function getAct(id: string): Promise<Act | null> {
	const db = getDatabase();
	const rows = await db.select<ActRow[]>('SELECT * FROM acts WHERE id = $1', [id]);
	return rows.length > 0 ? rowToAct(rows[0]) : null;
}

export async function getActNumber(id: string): Promise<number | null> {
	const db = getDatabase();
	const rows = await db.select<{ act_number: number }[]>('SELECT act_number FROM acts WHERE id = $1', [id]);
	return rows.length > 0 ? rows[0].act_number : null;
}

export async function getActsForStory(storyId: string): Promise<Act[]> {
	const db = getDatabase();
	const rows = await db.select<ActRow[]>('SELECT * FROM acts WHERE story_id = $1 ORDER BY act_number ASC', [storyId]);
	return rows.map(rowToAct);
}

export async function getActByActNumber(storyId: string, actNumber: number): Promise<Act | null> {
	const db = getDatabase();
	const rows = await db.select<ActRow[]>('SELECT * FROM acts WHERE story_id = $1 AND act_number = $2 LIMIT 1;', [storyId, actNumber]);
	return rows.length > 0 ? rowToAct(rows[0]) : null;
}

export async function updateAct(id: string, name: string): Promise<void> {
	const db = getDatabase();
	const now = Date.now();
	await db.execute('UPDATE acts SET name = $1, updated_at = $2 WHERE id = $3', [name, now, id]);
}

export async function deleteAct(id: string): Promise<void> {
	const db = getDatabase();

	const actLineRows = await db.select<{ id: string }[]>('SELECT id FROM act_line_meta WHERE act_id = $1', [id]);
	for (const row of actLineRows) {
		await deleteActLine(row.id);
	}

	await db.execute('DELETE FROM acts WHERE id = $1', [id]);
}

export async function getActsContinuingFrom(actLineId: string): Promise<Act[]> {
	const db = getDatabase();
	const rows = await db.select<ActRow[]>('SELECT * FROM acts WHERE continues_from_act_line_id = $1', [actLineId]);
	return rows.map(rowToAct);
}

export async function getActByActLineId(actLineId: string): Promise<Act | null> {
	const db = getDatabase();
	const rows = await db.select<ActRow[]>(
		`SELECT a.* FROM acts a
		 JOIN act_line_meta alm ON alm.act_id = a.id
		 WHERE alm.id = $1`,
		[actLineId]
	);
	return rows.length > 0 ? rowToAct(rows[0]) : null;
}

/**
 * Walk the act chain backwards from the given act line via `continuesFromActLineId`.
 *
 * @param actLineId The act line to walk from.
 * @param descending Defaults to `false`, sorted ascending by `actNumber` (oldest act first).
 *                   If `true`, returns entries sorted descending by `actNumber` (newest act first).
 *
 */
export async function traceActLineChain(actLineId: string, descending?: boolean): Promise<ActChainEntry[]> {
	const result: ActChainEntry[] = [];
	let currentActLineId: string | null = actLineId;
	const visited = new Set<string>();

	while (currentActLineId && !visited.has(currentActLineId)) {
		visited.add(currentActLineId);
		const act = await getActByActLineId(currentActLineId);
		if (!act) break;
		const actLine = await getActLine(currentActLineId);
		result.unshift({ actLineId: currentActLineId, actNumber: act.actNumber, isMainLine: actLine?.isMainLine ?? false });
		currentActLineId = act.continuesFromActLineId;
	}

	if (descending) result.reverse();
	return result;
}
