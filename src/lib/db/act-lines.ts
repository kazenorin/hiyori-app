import { getDatabase } from './database';
import type { Message } from './messages';
import { parseGameData } from './messages';

export interface ActLineMeta {
	id: string;
	actId: string;
	name: string;
	isMainLine: boolean;
	createdAt: number;
}

interface ActLineMetaRow {
	id: string;
	act_id: string;
	name: string;
	is_main_line: number;
	created_at: number;
}

interface ActLineEntry {
	actLineId: string;
	messageId: string;
	sequence: number;
}

interface ActLineEntryRow {
	act_line_id: string;
	message_id: string;
	sequence: number;
}

interface MessageInLine {
	id: string;
	role: string;
	content: string;
	reasoning: string | null;
	metadata: string | null;
	game_data: string | null;
	created_at: number;
	sequence: number;
}

function rowToActLineMeta(row: ActLineMetaRow): ActLineMeta {
	return {
		id: row.id,
		actId: row.act_id,
		name: row.name,
		isMainLine: row.is_main_line === 1,
		createdAt: row.created_at
	};
}

// === act_line_meta operations ===

export async function createActLine(id: string, actId: string, name: string, isMainLine: boolean = false): Promise<ActLineMeta> {
	const db = getDatabase();
	const now = Date.now();
	await db.execute(
		'INSERT INTO act_line_meta (id, act_id, name, is_main_line, created_at) VALUES ($1, $2, $3, $4, $5)',
		[id, actId, name, isMainLine ? 1 : 0, now]
	);
	return { id, actId, name, isMainLine, createdAt: now };
}

export async function getActLine(id: string): Promise<ActLineMeta | null> {
	const db = getDatabase();
	const rows = await db.select<ActLineMetaRow[]>(
		'SELECT * FROM act_line_meta WHERE id = $1',
		[id]
	);
	return rows.length > 0 ? rowToActLineMeta(rows[0]) : null;
}

export async function getActLinesForAct(actId: string): Promise<ActLineMeta[]> {
	const db = getDatabase();
	const rows = await db.select<ActLineMetaRow[]>(
		'SELECT * FROM act_line_meta WHERE act_id = $1 ORDER BY created_at ASC',
		[actId]
	);
	return rows.map(rowToActLineMeta);
}

export async function getMainLineForAct(actId: string): Promise<ActLineMeta | null> {
	const db = getDatabase();
	const rows = await db.select<ActLineMetaRow[]>(
		'SELECT * FROM act_line_meta WHERE act_id = $1 AND is_main_line = 1 LIMIT 1',
		[actId]
	);
	if (rows.length > 0) return rowToActLineMeta(rows[0]);
	// Fallback: return first by creation date
	const fallback = await db.select<ActLineMetaRow[]>(
		'SELECT * FROM act_line_meta WHERE act_id = $1 ORDER BY created_at ASC LIMIT 1',
		[actId]
	);
	return fallback.length > 0 ? rowToActLineMeta(fallback[0]) : null;
}

export async function updateActLine(id: string, name: string): Promise<void> {
	const db = getDatabase();
	await db.execute('UPDATE act_line_meta SET name = $1 WHERE id = $2', [name, id]);
}

export async function deleteActLine(id: string): Promise<void> {
	const db = getDatabase();
	await db.execute('DELETE FROM act_line_meta WHERE id = $1', [id]);
}

// === act_lines operations ===

export async function getMessagesForLine(actLineId: string): Promise<Message[]> {
	const db = getDatabase();
	const rows = await db.select<MessageInLine[]>(`
		SELECT m.id, m.role, m.content, m.reasoning, m.metadata, m.game_data, m.created_at, al.sequence
		FROM act_lines al
		JOIN messages m ON al.message_id = m.id
		WHERE al.act_line_id = $1
		ORDER BY al.sequence ASC
	`, [actLineId]);

	return rows.map((row) => ({
		id: row.id,
		role: row.role as 'user' | 'assistant',
		content: row.content,
		reasoning: row.reasoning ?? undefined,
		metadata: row.metadata ?? undefined,
		gameData: parseGameData(row.game_data),
		createdAt: row.created_at
	}));
}

export async function addMessageToLine(
	actLineId: string,
	messageId: string,
	sequence: number
): Promise<void> {
	const db = getDatabase();
	await db.execute(
		'INSERT INTO act_lines (act_line_id, message_id, sequence) VALUES ($1, $2, $3)',
		[actLineId, messageId, sequence]
	);
}

export async function deleteLineEntries(actLineId: string): Promise<void> {
	const db = getDatabase();
	await db.execute('DELETE FROM act_lines WHERE act_line_id = $1', [actLineId]);
}

export async function removeLastMessageEntries(actLineId: string, count: number): Promise<void> {
	const db = getDatabase();

	// Get the last N message entries
	const entries = await db.select<ActLineEntryRow[]>(
		'SELECT * FROM act_lines WHERE act_line_id = $1 ORDER BY sequence DESC LIMIT $2',
		[actLineId, count]
	);

	if (entries.length === 0) return;

	const messageIds = entries.map((e) => e.message_id);

	try {
		await db.execute('BEGIN');

		// Delete from act_lines junction using IN clause
		const placeholders = messageIds.map((_, i) => `$${i + 2}`).join(', ');
		await db.execute(
			`DELETE FROM act_lines WHERE act_line_id = $1 AND message_id IN (${placeholders})`,
			[actLineId, ...messageIds]
		);

		// Only delete messages that are no longer referenced by any act line
		for (const msgId of messageIds) {
			const refs = await db.select<{ cnt: number }[]>(
				'SELECT COUNT(*) as cnt FROM act_lines WHERE message_id = $1',
				[msgId]
			);
			if (refs[0].cnt === 0) {
				await db.execute('DELETE FROM messages WHERE id = $1', [msgId]);
			}
		}

		await db.execute('COMMIT');
	} catch (err) {
		await db.execute('ROLLBACK');
		throw err;
	}
}

export async function getNextSequence(actLineId: string): Promise<number> {
	const db = getDatabase();
	const rows = await db.select<{ max: number | null }[]>(
		'SELECT MAX(sequence) as max FROM act_lines WHERE act_line_id = $1',
		[actLineId]
	);
	return (rows[0]?.max ?? 0) + 1;
}

export async function getMessageSequence(actLineId: string, messageId: string): Promise<number | null> {
	const db = getDatabase();
	const rows = await db.select<{ sequence: number }[]>(
		'SELECT sequence FROM act_lines WHERE act_line_id = $1 AND message_id = $2',
		[actLineId, messageId]
	);
	return rows.length > 0 ? rows[0].sequence : null;
}

export async function branchFromLine(
	newLineId: string,
	fromLineId: string,
	fromSequence: number,
	actId: string,
	name: string
): Promise<ActLineMeta> {
	const db = getDatabase();

	// Create new act line meta (branches are never main lines)
	const lineMeta = await createActLine(newLineId, actId, name, false);

	// Copy entries up to fromSequence
	const entries = await db.select<ActLineEntryRow[]>(
		'SELECT * FROM act_lines WHERE act_line_id = $1 AND sequence <= $2 ORDER BY sequence ASC',
		[fromLineId, fromSequence]
	);

	if (entries.length === 0) return lineMeta;

	try {
		await db.execute('BEGIN');

		// Batch insert all entries
		const values = entries.map((e, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(', ');
		const params = entries.flatMap((e) => [newLineId, e.message_id, e.sequence]);
		await db.execute(
			`INSERT INTO act_lines (act_line_id, message_id, sequence) VALUES ${values}`,
			params
		);

		await db.execute('COMMIT');
	} catch (err) {
		await db.execute('ROLLBACK');
		throw err;
	}

	return lineMeta;
}