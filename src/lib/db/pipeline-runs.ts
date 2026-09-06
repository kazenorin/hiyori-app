import { getDatabase } from './database';
import type { PipelineState } from '$lib/ai/pipeline/types';
import type { PhaseMetadata } from '$lib/ai/chat-stream';
import type { EndingType } from '$lib/ai/narrative-types';

export type PipelineRunKind = 'main' | 'epilogue';

/**
 * Minimal, non-re-derivable inputs captured at run start.
 * Everything else (world content, act plot, summaries, profiles, player
 * response, ...) is rebuilt from DB/files when a run is resumed.
 */
export interface RunInputSnapshot {
	directorNotes: string;
	completedScenes: number;
	targetWordCount?: number;
	playerMessageId?: string;
	endingType?: EndingType;
}

export interface PipelineRunRecord {
	messageId: string;
	actLineId: string;
	storyId: string;
	kind: PipelineRunKind;
	state: PipelineState;
	phaseMetadata: PhaseMetadata[];
	inputSnapshot: RunInputSnapshot;
	createdAt: number;
	updatedAt: number;
}

interface PipelineRunRow {
	message_id: string;
	act_line_id: string;
	story_id: string;
	kind: string;
	state: string;
	phase_metadata: string | null;
	input_snapshot: string;
	created_at: number;
	updated_at: number;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function mapRowToRecord(row: PipelineRunRow): PipelineRunRecord {
	return {
		messageId: row.message_id,
		actLineId: row.act_line_id,
		storyId: row.story_id,
		kind: row.kind === 'epilogue' ? 'epilogue' : 'main',
		state: parseJson<PipelineState>(row.state, {}),
		phaseMetadata: parseJson<PhaseMetadata[]>(row.phase_metadata, []),
		inputSnapshot: parseJson<RunInputSnapshot>(row.input_snapshot, { directorNotes: '', completedScenes: 0 }),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

const SELECT_COLUMNS = 'message_id, act_line_id, story_id, kind, state, phase_metadata, input_snapshot, created_at, updated_at';

/** Insert or update the cache row for a run (keyed by the pre-created assistant message id). */
export async function upsertPipelineRun(run: PipelineRunRecord): Promise<void> {
	const db = getDatabase();
	await db.execute(
		`INSERT INTO pipeline_runs (message_id, act_line_id, story_id, kind, state, phase_metadata, input_snapshot, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 ON CONFLICT(message_id) DO UPDATE SET
			state = excluded.state,
			phase_metadata = excluded.phase_metadata,
			input_snapshot = excluded.input_snapshot,
			updated_at = excluded.updated_at`,
		[
			run.messageId,
			run.actLineId,
			run.storyId,
			run.kind,
			JSON.stringify(run.state),
			JSON.stringify(run.phaseMetadata),
			JSON.stringify(run.inputSnapshot),
			run.createdAt,
			run.updatedAt,
		]
	);
}

/** Get the cached run for an act line, if any (at most one run per line). */
export async function getPipelineRunForActLine(actLineId: string): Promise<PipelineRunRecord | null> {
	const db = getDatabase();
	const rows = await db.select<PipelineRunRow[]>(
		`SELECT ${SELECT_COLUMNS} FROM pipeline_runs WHERE act_line_id = $1 ORDER BY updated_at DESC LIMIT 1`,
		[actLineId]
	);
	return rows.length > 0 ? mapRowToRecord(rows[0]) : null;
}

/**
 * Update the cache row only if it still exists. Returns false when the row
 * was deleted externally (story/act/line removed), letting a live run abort.
 */
export async function updatePipelineRunIfExists(run: PipelineRunRecord): Promise<boolean> {
	const db = getDatabase();
	const result = await db.execute(
		`UPDATE pipeline_runs SET state = $1, phase_metadata = $2, input_snapshot = $3, updated_at = $4 WHERE message_id = $5`,
		[JSON.stringify(run.state), JSON.stringify(run.phaseMetadata), JSON.stringify(run.inputSnapshot), run.updatedAt, run.messageId]
	);
	return result.rowsAffected > 0;
}

export async function getPipelineRun(messageId: string): Promise<PipelineRunRecord | null> {
	const db = getDatabase();
	const rows = await db.select<PipelineRunRow[]>(`SELECT ${SELECT_COLUMNS} FROM pipeline_runs WHERE message_id = $1`, [messageId]);
	return rows.length > 0 ? mapRowToRecord(rows[0]) : null;
}

export async function getPipelineRunsForStory(storyId: string): Promise<PipelineRunRecord[]> {
	const db = getDatabase();
	const rows = await db.select<PipelineRunRow[]>(`SELECT ${SELECT_COLUMNS} FROM pipeline_runs WHERE story_id = $1`, [storyId]);
	return rows.map(mapRowToRecord);
}

export async function deletePipelineRun(messageId: string): Promise<void> {
	const db = getDatabase();
	await db.execute('DELETE FROM pipeline_runs WHERE message_id = $1', [messageId]);
}

export async function deletePipelineRunsForActLine(actLineId: string): Promise<void> {
	const db = getDatabase();
	await db.execute('DELETE FROM pipeline_runs WHERE act_line_id = $1', [actLineId]);
}

/** Must run before the act's act_line_meta rows are deleted. */
export async function deletePipelineRunsForAct(actId: string): Promise<void> {
	const db = getDatabase();
	await db.execute('DELETE FROM pipeline_runs WHERE act_line_id IN (SELECT id FROM act_line_meta WHERE act_id = $1)', [actId]);
}

export async function deletePipelineRunsForStory(storyId: string): Promise<void> {
	const db = getDatabase();
	await db.execute('DELETE FROM pipeline_runs WHERE story_id = $1', [storyId]);
}
