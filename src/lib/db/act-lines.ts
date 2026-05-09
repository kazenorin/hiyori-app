import Database from '@tauri-apps/plugin-sql';
import { getDatabase } from './database';
import type { Message } from './messages';
import { parseVariables } from './messages';
import type { Story } from './stories';

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
	variables: string | null;
	scene_number: number | null;
	act_summary: string | null;
	scene_plot: string | null;
	created_at: number;
	sequence: number;
}

function rowToActLineMeta(row: ActLineMetaRow): ActLineMeta {
	return {
		id: row.id,
		actId: row.act_id,
		name: row.name,
		isMainLine: row.is_main_line === 1,
		createdAt: row.created_at,
	};
}

// === act_line_meta operations ===

export async function createActLine(id: string, actId: string, name: string, isMainLine: boolean = false): Promise<ActLineMeta> {
	const db = getDatabase();
	const now = Date.now();
	await db.execute('INSERT INTO act_line_meta (id, act_id, name, is_main_line, created_at) VALUES ($1, $2, $3, $4, $5)', [
		id,
		actId,
		name,
		isMainLine ? 1 : 0,
		now,
	]);
	return { id, actId, name, isMainLine, createdAt: now };
}

export async function getActLine(id: string): Promise<ActLineMeta | null> {
	const db = getDatabase();
	const rows = await db.select<ActLineMetaRow[]>('SELECT * FROM act_line_meta WHERE id = $1', [id]);
	return rows.length > 0 ? rowToActLineMeta(rows[0]) : null;
}

export async function getActLinesForAct(actId: string): Promise<ActLineMeta[]> {
	const db = getDatabase();
	const rows = await db.select<ActLineMetaRow[]>('SELECT * FROM act_line_meta WHERE act_id = $1 ORDER BY created_at', [actId]);
	return rows.map(rowToActLineMeta);
}

export async function getMainLineForAct(actId: string): Promise<ActLineMeta | null> {
	const db = getDatabase();
	const rows = await db.select<ActLineMetaRow[]>('SELECT * FROM act_line_meta WHERE act_id = $1 AND is_main_line = 1 LIMIT 1', [actId]);
	if (rows.length > 0) return rowToActLineMeta(rows[0]);
	// Fallback: return first by creation date
	const fallback = await db.select<ActLineMetaRow[]>('SELECT * FROM act_line_meta WHERE act_id = $1 ORDER BY created_at LIMIT 1', [actId]);
	return fallback.length > 0 ? rowToActLineMeta(fallback[0]) : null;
}

export async function updateActLine(id: string, name: string): Promise<void> {
	const db = getDatabase();
	await db.execute('UPDATE act_line_meta SET name = $1 WHERE id = $2', [name, id]);
}

export async function deleteActLine(id: string): Promise<void> {
	const db = getDatabase();

	// Collect all message IDs from both junction tables before deletion
	const lineMessageRows = await db.select<{ message_id: string }[]>('SELECT message_id FROM act_lines WHERE act_line_id = $1', [id]);
	const premiseMessageRows = await db.select<{ message_id: string }[]>('SELECT message_id FROM act_line_premises WHERE act_line_id = $1', [
		id,
	]);
	const messageIds = [...new Set([...lineMessageRows.map((r) => r.message_id), ...premiseMessageRows.map((r) => r.message_id)])];

	// Delete junction table entries
	await db.execute('DELETE FROM act_lines WHERE act_line_id = $1', [id]);
	await db.execute('DELETE FROM act_line_premises WHERE act_line_id = $1', [id]);

	// Garbage-collect messages no longer referenced by any act line or premises
	await removeOrphanedMessages(db, messageIds);

	// Delete the act line metadata row
	await db.execute('DELETE FROM act_line_meta WHERE id = $1', [id]);
}

// === act_lines operations ===

export async function getMessagesForLine(actLineId: string): Promise<Message[]> {
	const db = getDatabase();
	const rows = await db.select<MessageInLine[]>(
		`
		SELECT m.id, m.role, m.content, m.reasoning, m.metadata, m.variables, m.scene_number, m.act_summary, m.scene_plot, m.created_at, al.sequence
		FROM act_lines al
		JOIN messages m ON al.message_id = m.id
		WHERE al.act_line_id = $1
		ORDER BY al.sequence
	`,
		[actLineId]
	);

	return rows.map((row) => ({
		id: row.id,
		role: row.role as 'user' | 'assistant',
		content: row.content,
		reasoning: row.reasoning ?? undefined,
		metadata: row.metadata ?? undefined,
		variables: parseVariables(row.variables),
		sceneNumber: row.scene_number ?? undefined,
		actSummary: row.act_summary ?? undefined,
		scenePlot: row.scene_plot ?? undefined,
		createdAt: row.created_at,
	}));
}

export async function addMessageToLine(actLineId: string, messageId: string, sequence: number): Promise<void> {
	const db = getDatabase();
	await db.execute('INSERT INTO act_lines (act_line_id, message_id, sequence) VALUES ($1, $2, $3)', [actLineId, messageId, sequence]);
}

export async function deleteLineEntries(actLineId: string): Promise<void> {
	const db = getDatabase();
	await db.execute('DELETE FROM act_lines WHERE act_line_id = $1', [actLineId]);
}

export async function removeMessagesFromActLine(actLineId: string, messageIds: string[]): Promise<string[]> {
	if (messageIds.length === 0) return [];
	const db = getDatabase();

	const placeholders = messageIds.map((_, i) => `$${i + 2}`).join(', ');
	await db.execute(`DELETE FROM act_lines WHERE act_line_id = $1 AND message_id IN (${placeholders})`, [actLineId, ...messageIds]);

	await removeOrphanedMessages(db, messageIds);
	return messageIds;
}

export async function getNextSequence(actLineId: string): Promise<number> {
	const db = getDatabase();
	const rows = await db.select<{ max: number | null }[]>('SELECT MAX(sequence) as max FROM act_lines WHERE act_line_id = $1', [actLineId]);
	return (rows[0]?.max ?? 0) + 1;
}

export async function getMessageSequence(actLineId: string, messageId: string): Promise<number | null> {
	const db = getDatabase();
	const rows = await db.select<{ sequence: number }[]>('SELECT sequence FROM act_lines WHERE act_line_id = $1 AND message_id = $2', [
		actLineId,
		messageId,
	]);
	return rows.length > 0 ? rows[0].sequence : null;
}

export async function getMessageIdsUpToSequence(actLineId: string, fromSequence: number): Promise<string[]> {
	const db = getDatabase();
	const rows = await db.select<{ message_id: string }[]>(
		'SELECT message_id FROM act_lines WHERE act_line_id = $1 AND sequence <= $2 ORDER BY sequence',
		[actLineId, fromSequence]
	);
	return rows.map((r) => r.message_id);
}

export async function getActNumberForActLine(actLineId: string): Promise<number | null> {
	const db = getDatabase();
	const rows = await db.select<{ act_number: number }[]>(
		'SELECT a.act_number FROM act_line_meta alm JOIN acts a ON a.id = alm.act_id WHERE alm.id = $1',
		[actLineId]
	);
	return rows.length > 0 ? rows[0].act_number : null;
}

export async function getStoryForActLine(actLineId: string): Promise<Story> {
	const db = getDatabase();
	const rows = await db.select<{ id: string; name: string; created_at: number; updated_at: number }[]>(
		'SELECT s.id, s.name, s.created_at, s.updated_at FROM act_line_meta alm JOIN acts a ON a.id = alm.act_id JOIN stories s ON s.id = a.story_id WHERE alm.id = $1',
		[actLineId]
	);
	if (rows.length > 0) {
		const row = rows[0];
		return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at };
	} else {
		throw new Error('Orphaned Act Line with no Story');
	}
}

/**
 * Batch-resolve act number, max sequence, and message sequences for multiple act lines.
 * Input: Record mapping actLineId to array of messageIds.
 * Returns a map keyed by actLineId with act info and per-message sequences.
 */
export async function batchResolveActLineInfo(
	items: Record<string, string[]>
): Promise<Map<string, { actNumber: number | null; maxSeq: number; messages: Map<string, number | null> }>> {
	const actLineIds = Object.keys(items);
	if (actLineIds.length === 0) return new Map();

	const db = getDatabase();

	// Query 1: get act_number and max_sequence per actLineId
	const ph = actLineIds.map((_, i) => `$${i + 1}`).join(', ');
	const offset = actLineIds.length;
	const ph2 = actLineIds.map((_, i) => `$${i + offset + 1}`).join(', ');

	interface ActLineInfoRow {
		act_line_id: string;
		act_number: number;
		max_sequence: number;
	}
	const actLineInfoRows = await db.select<ActLineInfoRow[]>(
		`SELECT alm.id as act_line_id, a.act_number, COALESCE(ms.max_sequence, 0) as max_sequence
		 FROM act_line_meta alm
		 JOIN acts a ON a.id = alm.act_id
		 LEFT JOIN (
			 SELECT sal.act_line_id, MAX(sal.sequence) as max_sequence
			 FROM act_lines sal
			 WHERE sal.act_line_id IN (${ph})
			 GROUP BY sal.act_line_id
		 ) ms ON ms.act_line_id = alm.id
		 WHERE alm.id IN (${ph2})`,
		[...actLineIds, ...actLineIds]
	);

	const actLineInfoMap = new Map<string, { actNumber: number; maxSeq: number }>();
	for (const row of actLineInfoRows) {
		actLineInfoMap.set(row.act_line_id, { actNumber: row.act_number, maxSeq: row.max_sequence });
	}

	// Query 2: get message sequences per actLineId
	const messageSeqMap = new Map<string, Map<string, number>>();
	for (const actLineId of actLineIds) {
		const messageIds = items[actLineId];
		if (messageIds.length === 0) continue;

		const msgPh = messageIds.map((_, i) => `$${i + 2}`).join(', ');
		const rows = await db.select<{ message_id: string; sequence: number }[]>(
			`SELECT al.message_id, al.sequence FROM act_lines al WHERE al.act_line_id = $1 AND al.message_id IN (${msgPh})`,
			[actLineId, ...messageIds]
		);

		const inner = new Map<string, number>();
		for (const row of rows) {
			inner.set(row.message_id, row.sequence);
		}
		messageSeqMap.set(actLineId, inner);
	}

	// Build result
	const result = new Map<string, { actNumber: number | null; maxSeq: number; messages: Map<string, number | null> }>();
	for (const actLineId of actLineIds) {
		const info = actLineInfoMap.get(actLineId);
		const msgs = messageSeqMap.get(actLineId) ?? new Map();
		const msgIds = items[actLineId];
		result.set(actLineId, {
			actNumber: info?.actNumber ?? null,
			maxSeq: info?.maxSeq ?? 0,
			messages: new Map(msgIds.map((id) => [id, msgs.get(id) ?? null])),
		});
	}
	return result;
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
		'SELECT * FROM act_lines WHERE act_line_id = $1 AND sequence <= $2 ORDER BY sequence',
		[fromLineId, fromSequence]
	);

	if (entries.length === 0) return lineMeta;

	// Batch insert all entries
	const values = entries.map((e, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(', ');
	const params = entries.flatMap((e) => [newLineId, e.message_id, e.sequence]);
	await db.execute(`INSERT INTO act_lines (act_line_id, message_id, sequence) VALUES ${values}`, params);

	// Copy premises (interview transcript) — always predates act line messages
	const premises = await db.select<ActLineEntryRow[]>('SELECT * FROM act_line_premises WHERE act_line_id = $1 ORDER BY sequence', [
		fromLineId,
	]);
	if (premises.length > 0) {
		const pValues = premises.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(', ');
		const pParams = premises.flatMap((p) => [newLineId, p.message_id, p.sequence]);
		await db.execute(`INSERT INTO act_line_premises (act_line_id, message_id, sequence) VALUES ${pValues}`, pParams);
	}

	return lineMeta;
}

// === act_line_premises operations ===

export async function addMessageToPremises(actLineId: string, messageId: string, sequence: number): Promise<void> {
	const db = getDatabase();
	await db.execute('INSERT INTO act_line_premises (act_line_id, message_id, sequence) VALUES ($1, $2, $3)', [
		actLineId,
		messageId,
		sequence,
	]);
}

export async function getPremisesMessages(actLineId: string): Promise<Message[]> {
	const db = getDatabase();
	const rows = await db.select<MessageInLine[]>(
		`
		SELECT m.id, m.role, m.content, m.reasoning, m.metadata, m.variables, m.scene_number, m.act_summary, m.scene_plot, m.created_at, p.sequence
		FROM act_line_premises p
		JOIN messages m ON p.message_id = m.id
		WHERE p.act_line_id = $1
		ORDER BY p.sequence
	`,
		[actLineId]
	);

	return rows.map((row) => ({
		id: row.id,
		role: row.role as 'user' | 'assistant',
		content: row.content,
		reasoning: row.reasoning ?? undefined,
		metadata: row.metadata ?? undefined,
		variables: parseVariables(row.variables),
		sceneNumber: row.scene_number ?? undefined,
		actSummary: row.act_summary ?? undefined,
		scenePlot: row.scene_plot ?? undefined,
		createdAt: row.created_at,
	}));
}

export async function getNextPremisesSequence(actLineId: string): Promise<number> {
	const db = getDatabase();
	const rows = await db.select<{ max: number | null }[]>('SELECT MAX(sequence) as max FROM act_line_premises WHERE act_line_id = $1', [
		actLineId,
	]);
	return (rows[0]?.max ?? 0) + 1;
}

export async function removeMessagesFromPremises(actLineId: string, messageIds: string[]): Promise<string[]> {
	if (messageIds.length === 0) return [];
	const db = getDatabase();

	const placeholders = messageIds.map((_, i) => `$${i + 2}`).join(', ');
	await db.execute(`DELETE FROM act_line_premises WHERE act_line_id = $1 AND message_id IN (${placeholders})`, [actLineId, ...messageIds]);

	await removeOrphanedMessages(db, messageIds);
	return messageIds;
}

export async function getPreviousActSummary(actLineId: string): Promise<string | null> {
	const db = getDatabase();
	const rows = await db.select<{ act_summary: string }[]>(
		`SELECT m.act_summary
		 FROM act_line_meta alm
		 JOIN acts a ON a.id = alm.act_id
		 JOIN act_line_meta prev_alm ON a.continues_from_act_line_id = prev_alm.id
		 JOIN act_lines al ON prev_alm.id = al.act_line_id
		 JOIN messages m ON al.message_id = m.id
		 WHERE alm.id = $1
		   AND m.act_summary IS NOT NULL
		 ORDER BY al.sequence DESC
		 LIMIT 1`,
		[actLineId]
	);
	return rows.length > 0 ? rows[0].act_summary : null;
}

async function removeOrphanedMessages(db: Database, messageIds: string[]): Promise<string[]> {
	const deleted: string[] = [];
	for (const msgId of messageIds) {
		const refsInLines = await db.select<{ cnt: number }[]>('SELECT COUNT(*) as cnt FROM act_lines WHERE message_id = $1', [msgId]);
		const refsInPremises = await db.select<{ cnt: number }[]>('SELECT COUNT(*) as cnt FROM act_line_premises WHERE message_id = $1', [
			msgId,
		]);
		if (refsInLines[0].cnt === 0 && refsInPremises[0].cnt === 0) {
			await db.execute('DELETE FROM messages WHERE id = $1', [msgId]);
			deleted.push(msgId);
		}
	}
	return deleted;
}
