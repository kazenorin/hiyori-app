import Database from '@tauri-apps/plugin-sql';
import { getDatabase } from './database';
import type { Message } from './messages';
import { type MessageRow, mapRowToMessage, cloneMessage } from './messages';
import type { Story } from './stories';
import type { PlotMode, ActPhase } from '$lib/ai/narrative-types';
import { getActPhaseIndex, isValidPlotMode } from '$lib/ai/narrative-types';

export interface ActLineMeta {
	id: string;
	actId: string;
	name: string;
	isMainLine: boolean;
	createdAt: number;
	plotMode: PlotMode;
	lastPlotGeneration: number | null;
	actPhase: ActPhase | null;
}

interface ActLineMetaRow {
	id: string;
	act_id: string;
	name: string;
	is_main_line: number;
	created_at: number;
	plot_mode: string;
	last_plot_generation: number | null;
	act_phase: string | null;
}

interface ActLineEntryRow {
	act_line_id: string;
	message_id: string;
	sequence: number;
}

function rowToActLineMeta(row: ActLineMetaRow): ActLineMeta {
	const plotMode: PlotMode = isValidPlotMode(row.plot_mode) ? row.plot_mode : 'guidance';
	const actPhase: ActPhase | null = row.act_phase && getActPhaseIndex(row.act_phase) >= 0 ? (row.act_phase as ActPhase) : null;
	return {
		id: row.id,
		actId: row.act_id,
		name: row.name,
		isMainLine: row.is_main_line === 1,
		createdAt: row.created_at,
		plotMode,
		lastPlotGeneration: row.last_plot_generation,
		actPhase,
	};
}

// === act_line_meta operations ===

/** Create a new act line. initialActPhase: undefined = auto-set based on plotMode; null = explicitly no phase. */
export async function createActLine(
	id: string,
	actId: string,
	name: string,
	isMainLine: boolean = false,
	plotMode: PlotMode = 'guidance',
	initialActPhase?: ActPhase | null
): Promise<ActLineMeta> {
	const db = getDatabase();
	const now = Date.now();
	const actPhase: ActPhase | null = initialActPhase !== undefined ? initialActPhase : plotMode === 'phaseEvent' ? 'introduction' : null;
	await db.execute(
		'INSERT INTO act_line_meta (id, act_id, name, is_main_line, created_at, plot_mode, last_plot_generation, act_phase) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
		[id, actId, name, isMainLine ? 1 : 0, now, plotMode, null, actPhase]
	);
	return { id, actId, name, isMainLine, createdAt: now, plotMode, lastPlotGeneration: null, actPhase };
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
	const rows = await db.select<MessageRow[]>(
		`
		SELECT m.id, m.role, m.content, m.reasoning, m.metadata, m.variables, m.scene_number, m.act_summary, m.scene_plot, m.important_phrases, m.created_at, al.sequence
		FROM act_lines al
		JOIN messages m ON al.message_id = m.id
		WHERE al.act_line_id = $1
		ORDER BY al.sequence
	`,
		[actLineId]
	);

	return rows.map(mapRowToMessage);
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
	const rows = await db.select<{ id: string; name: string; locale: string; created_at: number; updated_at: number }[]>(
		'SELECT s.id, s.name, s.locale, s.created_at, s.updated_at FROM act_line_meta alm JOIN acts a ON a.id = alm.act_id JOIN stories s ON s.id = a.story_id WHERE alm.id = $1',
		[actLineId]
	);
	if (rows.length > 0) {
		const row = rows[0];
		return { id: row.id, name: row.name, locale: row.locale, createdAt: row.created_at, updatedAt: row.updated_at };
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

export interface BranchResult {
	lineMeta: ActLineMeta;
	/** Remapped message IDs: original → cloned. Empty for non-fork-point messages. */
	remappedMessageIds: Map<string, string>;
}

export async function branchFromLine(
	newLineId: string,
	fromLineId: string,
	fromSequence: number,
	actId: string,
	name: string,
	plotModeOverride?: PlotMode
): Promise<BranchResult> {
	const db = getDatabase();

	// Resolve mode: override takes precedence, otherwise inherit from source
	const sourceLine = await getActLine(fromLineId);
	const resolvedMode = plotModeOverride ?? sourceLine?.plotMode ?? 'guidance';
	// When no mode override, inherit source line's actPhase; switching modes resets it
	const initialActPhase = plotModeOverride === undefined ? sourceLine?.actPhase : undefined;

	// Create new act line meta (branches are never main lines)
	const lineMeta = await createActLine(newLineId, actId, name, false, resolvedMode, initialActPhase);

	// Copy entries up to fromSequence
	const entries = await db.select<ActLineEntryRow[]>(
		'SELECT * FROM act_lines WHERE act_line_id = $1 AND sequence <= $2 ORDER BY sequence',
		[fromLineId, fromSequence]
	);

	if (entries.length === 0) return { lineMeta, remappedMessageIds: new Map() };

	// Clone the last message at the fork point so the forked line owns its own copy.
	// This prevents metadata writes (e.g. turnOfEvents) on the forked line from
	// polluting the original line's message.
	const lastEntry = entries[entries.length - 1];
	const clonedId = crypto.randomUUID();
	await cloneMessage(lastEntry.message_id, clonedId);

	const remappedMessageIds = new Map<string, string>();
	remappedMessageIds.set(lastEntry.message_id, clonedId);

	// Build junction entries: all share original message_ids except the last,
	// which points to the cloned message.
	const forkedEntries = entries.map((e, i) => (i === entries.length - 1 ? { ...e, message_id: clonedId } : e));

	const values = forkedEntries.map((e, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(', ');
	const params = forkedEntries.flatMap((e) => [newLineId, e.message_id, e.sequence]);
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

	return { lineMeta, remappedMessageIds };
}

export async function getLastSceneNumber(actLineId: string): Promise<number | null> {
	const db = getDatabase();
	const rows = await db.select<{ scene_number: number }[]>(
		`SELECT m.scene_number
		 FROM act_lines al
		 JOIN messages m ON al.message_id = m.id
		 WHERE al.act_line_id = $1 AND m.scene_number IS NOT NULL
		 ORDER BY al.sequence DESC
		 LIMIT 1`,
		[actLineId]
	);
	return rows.length > 0 ? rows[0].scene_number : null;
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
	const rows = await db.select<MessageRow[]>(
		`
		SELECT m.id, m.role, m.content, m.reasoning, m.metadata, m.variables, m.scene_number, m.act_summary, m.scene_plot, m.important_phrases, m.created_at, p.sequence
		FROM act_line_premises p
		JOIN messages m ON p.message_id = m.id
		WHERE p.act_line_id = $1
		ORDER BY p.sequence
	`,
		[actLineId]
	);

	return rows.map(mapRowToMessage);
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

export async function getLatestTurnOfEvents(actLineId: string): Promise<string | null> {
	const db = getDatabase();
	const rows = await db.select<{ turn_of_events: string }[]>(
		`SELECT json_extract(m.variables, '$.turnOfEvents') as turn_of_events
		 FROM act_lines al
		 JOIN messages m ON al.message_id = m.id
		 WHERE al.act_line_id = $1
		   AND m.variables IS NOT NULL
		   AND json_extract(m.variables, '$.turnOfEvents') IS NOT NULL
		 ORDER BY al.sequence DESC
		 LIMIT 1`,
		[actLineId]
	);
	return rows.length > 0 ? rows[0].turn_of_events : null;
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

// === plot mode / act phase operations ===

export async function updateActLineMetaFields(
	id: string,
	fields: { actPhase?: ActPhase | null; lastPlotGeneration?: number | null; plotMode?: PlotMode }
): Promise<void> {
	const db = getDatabase();
	const setClauses: string[] = [];
	const params: unknown[] = [];
	let paramIdx = 1;

	if (fields.actPhase !== undefined) {
		setClauses.push(`act_phase = $${paramIdx++}`);
		params.push(fields.actPhase);
	}
	if (fields.lastPlotGeneration !== undefined) {
		setClauses.push(`last_plot_generation = $${paramIdx++}`);
		params.push(fields.lastPlotGeneration);
	}
	if (fields.plotMode !== undefined) {
		setClauses.push(`plot_mode = $${paramIdx++}`);
		params.push(fields.plotMode);
	}
	if (setClauses.length === 0) return;

	params.push(id);
	await db.execute(`UPDATE act_line_meta SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`, params);
}

export async function advanceActPhase(id: string, newPhase: ActPhase): Promise<void> {
	const current = await getActLine(id);
	if (!current) throw new Error(`Act line ${id} not found`);
	if (!current.actPhase) throw new Error(`Cannot advance phase: act line ${id} has no current phase`);
	const currentIdx = getActPhaseIndex(current.actPhase);
	const newIdx = getActPhaseIndex(newPhase);
	if (newIdx <= currentIdx) {
		throw new Error(`Invalid phase transition: ${current.actPhase} → ${newPhase}. Phases must advance forward.`);
	}
	if (newIdx < 0) throw new Error(`Invalid act phase: ${newPhase}`);
	// Reset lastPlotGeneration: the Plot Planner must re-evaluate
	// on the first scene of the new phase so it can adjust to the phase change.
	await updateActLineMetaFields(id, { actPhase: newPhase, lastPlotGeneration: null });
}
