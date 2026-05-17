import { getDatabase } from './database';

export interface DirectorNote {
	id: string;
	actLineId: string;
	text: string;
	isActive: boolean;
	effectiveFromScene: number | null;
	effectiveToScene: number | null;
	createdAt: number;
}

interface DirectorNoteRow {
	id: string;
	act_line_id: string;
	text: string;
	is_active: number;
	effective_from_scene: number | null;
	effective_to_scene: number | null;
	created_at: number;
}

function mapRowToDirectorNote(row: DirectorNoteRow): DirectorNote {
	return {
		id: row.id,
		actLineId: row.act_line_id,
		text: row.text,
		isActive: row.is_active === 1,
		effectiveFromScene: row.effective_from_scene,
		effectiveToScene: row.effective_to_scene,
		createdAt: row.created_at,
	};
}

export async function getDirectorNotes(actLineId: string): Promise<DirectorNote[]> {
	const db = getDatabase();
	const rows = await db.select<DirectorNoteRow[]>(
		'SELECT * FROM director_notes WHERE act_line_id = $1 ORDER BY created_at',
		[actLineId]
	);
	return rows.map(mapRowToDirectorNote);
}

export async function createDirectorNote(
	id: string,
	actLineId: string,
	text: string,
	effectiveFromScene?: number | null,
	effectiveToScene?: number | null
): Promise<void> {
	const db = getDatabase();
	await db.execute(
		`INSERT INTO director_notes (id, act_line_id, text, is_active, effective_from_scene, effective_to_scene, created_at)
		 VALUES ($1, $2, $3, 1, $4, $5, $6)`,
		[id, actLineId, text, effectiveFromScene ?? null, effectiveToScene ?? null, Date.now()]
	);
}

export async function updateDirectorNote(
	id: string,
	fields: { text?: string; isActive?: boolean; effectiveFromScene?: number | null; effectiveToScene?: number | null }
): Promise<void> {
	const db = getDatabase();
	const sets: string[] = [];
	const values: (string | number | boolean | null)[] = [];
	let paramIndex = 1;

	if (fields.text !== undefined) {
		sets.push(`text = $${paramIndex++}`);
		values.push(fields.text);
	}
	if (fields.isActive !== undefined) {
		sets.push(`is_active = $${paramIndex++}`);
		values.push(fields.isActive ? 1 : 0);
	}
	if (fields.effectiveFromScene !== undefined) {
		sets.push(`effective_from_scene = $${paramIndex++}`);
		values.push(fields.effectiveFromScene);
	}
	if (fields.effectiveToScene !== undefined) {
		sets.push(`effective_to_scene = $${paramIndex++}`);
		values.push(fields.effectiveToScene);
	}

	if (sets.length === 0) return;

	values.push(id);
	await db.execute(
		`UPDATE director_notes SET ${sets.join(', ')} WHERE id = $${paramIndex}`,
		values
	);
}

export async function deleteDirectorNote(id: string): Promise<void> {
	const db = getDatabase();
	await db.execute('DELETE FROM director_notes WHERE id = $1', [id]);
}

export async function deleteDirectorNotesForActLine(actLineId: string): Promise<void> {
	const db = getDatabase();
	await db.execute('DELETE FROM director_notes WHERE act_line_id = $1', [actLineId]);
}

export async function cloneDirectorNotes(fromActLineId: string, toActLineId: string): Promise<void> {
	const db = getDatabase();
	const sourceNotes = await getDirectorNotes(fromActLineId);

	for (const note of sourceNotes) {
		const newId = crypto.randomUUID();
		await db.execute(
			`INSERT INTO director_notes (id, act_line_id, text, is_active, effective_from_scene, effective_to_scene, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[newId, toActLineId, note.text, note.isActive ? 1 : 0, note.effectiveFromScene, note.effectiveToScene, Date.now()]
		);
	}
}
