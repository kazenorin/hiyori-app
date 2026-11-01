import { getDatabase } from './database';
import type { PhaseName, UIScenePhase } from '$lib/ai/narrative-types';

interface MessagePhaseRow {
	message_id: string;
	phase_name: string;
	reasoning: string | null;
	content: string;
	sequence: number;
}

/** SQLite caps bound variables per statement; keep batches well under the historical limit of 999. */
const CHUNK_SIZE = 90;

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
}

function placeholders(count: number): string {
	return Array.from({ length: count }, (_, i) => `$${i + 1}`).join(', ');
}

/**
 * Insert-or-replace the phase rows for a message, keyed by (message_id, phase_name).
 * `sequence` is the array index so pipeline order stays stable regardless of write
 * timing; callers re-send the full array (never partial deletes).
 */
export async function upsertMessagePhases(messageId: string, phases: UIScenePhase[]): Promise<void> {
	if (phases.length === 0) return;
	const db = getDatabase();
	for (const [index, phase] of phases.entries()) {
		await db.execute(
			`INSERT INTO message_phases (message_id, phase_name, reasoning, content, sequence)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT(message_id, phase_name) DO UPDATE SET
				reasoning = excluded.reasoning,
				content = excluded.content,
				sequence = excluded.sequence`,
			[messageId, phase.phaseName, phase.reasoning ?? null, phase.content, index]
		);
	}
}

/** Batch-load phases for messages, ordered by sequence. Messages without rows are absent from the map. */
export async function getPhasesForMessages(messageIds: string[]): Promise<Map<string, UIScenePhase[]>> {
	const result = new Map<string, UIScenePhase[]>();
	if (messageIds.length === 0) return result;
	const db = getDatabase();
	for (const ids of chunk(messageIds, CHUNK_SIZE)) {
		const rows = await db.select<MessagePhaseRow[]>(
			`SELECT message_id, phase_name, reasoning, content, sequence FROM message_phases
			 WHERE message_id IN (${placeholders(ids.length)})
			 ORDER BY message_id, sequence`,
			ids
		);
		for (const row of rows) {
			const phase: UIScenePhase = {
				phaseName: row.phase_name as PhaseName,
				content: row.content,
				...(row.reasoning !== null && { reasoning: row.reasoning }),
			};
			const existing = result.get(row.message_id);
			if (existing) existing.push(phase);
			else result.set(row.message_id, [phase]);
		}
	}
	return result;
}

export async function deletePhasesForMessages(messageIds: string[]): Promise<void> {
	if (messageIds.length === 0) return;
	const db = getDatabase();
	for (const ids of chunk(messageIds, CHUNK_SIZE)) {
		await db.execute(`DELETE FROM message_phases WHERE message_id IN (${placeholders(ids.length)})`, ids);
	}
}
