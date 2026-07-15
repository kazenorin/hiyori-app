// noinspection SqlResolve

import { getDatabase } from './database';

interface SchemaVersion {
	version: number;
}

const migrationStatements: string[][] = [
	[
		`CREATE TABLE IF NOT EXISTS stories (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS acts (
			id TEXT PRIMARY KEY,
			story_id TEXT NOT NULL,
			name TEXT NOT NULL,
			act_number INTEGER NOT NULL,
			continues_from_act_line_id TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS messages (
			id TEXT PRIMARY KEY,
			role TEXT NOT NULL,
			content TEXT NOT NULL DEFAULT '',
			reasoning TEXT,
			metadata TEXT,
			variables TEXT,
			act_summary TEXT,
			scene_number INTEGER,
			created_at INTEGER NOT NULL DEFAULT (0)
		)`,
		`CREATE TABLE IF NOT EXISTS act_line_meta (
			id TEXT PRIMARY KEY,
			act_id TEXT NOT NULL,
			name TEXT NOT NULL,
			is_main_line INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS act_lines (
			act_line_id TEXT NOT NULL,
			message_id TEXT NOT NULL,
			sequence INTEGER NOT NULL,
			PRIMARY KEY (act_line_id, message_id, sequence)
		)`,
		`CREATE TABLE IF NOT EXISTS act_line_premises (
			act_line_id TEXT NOT NULL,
			message_id TEXT NOT NULL,
			sequence INTEGER NOT NULL,
			PRIMARY KEY (act_line_id, message_id, sequence)
		)`,
		`CREATE TABLE IF NOT EXISTS story_folders (
			story_id TEXT PRIMARY KEY,
			folder_name TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS app_state (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			active_story_id TEXT,
			active_act_id TEXT,
			active_act_line_id TEXT
		)`,
		`INSERT OR IGNORE INTO app_state (id) VALUES (1)`,
		`CREATE INDEX IF NOT EXISTS idx_act_lines_line ON act_lines(act_line_id)`,
		`CREATE INDEX IF NOT EXISTS idx_act_line_premises_line ON act_line_premises(act_line_id)`,
		`CREATE INDEX IF NOT EXISTS idx_act_line_meta_act ON act_line_meta(act_id)`,
		`CREATE INDEX IF NOT EXISTS idx_acts_story ON acts(story_id)`,
		`CREATE INDEX IF NOT EXISTS idx_story_folders_folder ON story_folders(folder_name)`,
	],
	[`ALTER TABLE messages ADD COLUMN scene_plot TEXT`],
	[`ALTER TABLE messages ADD COLUMN important_phrases TEXT`],
	[`ALTER TABLE stories ADD COLUMN locale TEXT NOT NULL DEFAULT 'en'`],
	[
		`CREATE TABLE IF NOT EXISTS director_notes (
			id TEXT PRIMARY KEY,
			act_line_id TEXT NOT NULL,
			text TEXT NOT NULL,
			is_active INTEGER NOT NULL DEFAULT 1,
			effective_from_scene INTEGER,
			effective_to_scene INTEGER,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_director_notes_line ON director_notes(act_line_id)`,
	],
	[
		`ALTER TABLE act_line_meta ADD COLUMN plot_mode TEXT NOT NULL DEFAULT 'guidance'`,
		`ALTER TABLE act_line_meta ADD COLUMN last_plot_generation INTEGER`,
		`ALTER TABLE act_line_meta ADD COLUMN act_phase TEXT`,
	],
	[`ALTER TABLE act_line_meta ADD COLUMN ended_at INTEGER`, `ALTER TABLE act_line_meta ADD COLUMN ending_type TEXT`],
	[`ALTER TABLE act_line_meta ADD COLUMN epilogue_written_at INTEGER`],
	[
		`CREATE TABLE IF NOT EXISTS act_line_events (
			id TEXT PRIMARY KEY,
			act_line_id TEXT NOT NULL,
			message_id TEXT,
			message_sequence INTEGER NOT NULL,
			event TEXT NOT NULL,
			value TEXT,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_act_line_events_line ON act_line_events(act_line_id)`,
		`CREATE INDEX IF NOT EXISTS idx_act_line_events_message ON act_line_events(message_id)`,
	],
	[
		`CREATE TABLE IF NOT EXISTS character_profiles (
		id TEXT PRIMARY KEY,
		act_line_id TEXT NOT NULL,
		scene_number INTEGER,
		canonical_name TEXT NOT NULL,
		preferred_name TEXT NOT NULL,
		aliases TEXT NOT NULL DEFAULT '[]',
		logline TEXT NOT NULL,
		state TEXT,
		goal TEXT,
		relationships TEXT,
		voice TEXT,
		scene_details TEXT NOT NULL DEFAULT '',
		importance INTEGER NOT NULL DEFAULT 4,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	)`,
		`CREATE INDEX IF NOT EXISTS idx_character_profiles_actline_scene ON character_profiles(act_line_id, scene_number DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_character_profiles_actline_canonical_scene ON character_profiles(act_line_id, canonical_name, scene_number DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_character_profiles_actline_preferred_scene ON character_profiles(act_line_id, preferred_name, scene_number DESC)`,
	],
];

interface ActLineMetaMigrateRow {
	id: string;
	plot_mode: string;
	last_plot_generation: number | null;
	act_phase: string | null;
	ended_at: number | null;
	ending_type: string | null;
	epilogue_written_at: number | null;
}

interface ActLineEntryMigrateRow {
	message_id: string;
	sequence: number;
}

interface MigratePlotGenRow {
	message_id: string;
	sequence: number;
}

async function migrateV9Data(): Promise<void> {
	const db = getDatabase();
	const now = Date.now();

	const rows = await db.select<ActLineMetaMigrateRow[]>(
		'SELECT id, plot_mode, last_plot_generation, act_phase, ended_at, ending_type, epilogue_written_at FROM act_line_meta'
	);

	for (const row of rows) {
		const actLineId = row.id;
		const isPhaseEvent = row.plot_mode === 'phaseEvent';

		if (isPhaseEvent && row.act_phase === null) {
			await db.execute(
				'INSERT INTO act_line_events (id, act_line_id, message_id, message_sequence, event, value, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
				[crypto.randomUUID(), actLineId, null, 0, 'act-phase-transition', 'introduction', now]
			);
		} else if (row.act_phase !== null) {
			await db.execute(
				'INSERT INTO act_line_events (id, act_line_id, message_id, message_sequence, event, value, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
				[crypto.randomUUID(), actLineId, null, 0, 'act-phase-transition', row.act_phase, now]
			);
		}

		if (row.last_plot_generation !== null) {
			const seqRows = await db.select<MigratePlotGenRow[]>(
				`SELECT al.message_id, al.sequence
				 FROM act_lines al
				 JOIN messages m ON m.id = al.message_id
				 WHERE al.act_line_id = $1 AND m.scene_number = $2
				 ORDER BY al.sequence DESC LIMIT 1`,
				[actLineId, row.last_plot_generation]
			);
			if (seqRows.length > 0) {
				await db.execute(
					'INSERT INTO act_line_events (id, act_line_id, message_id, message_sequence, event, value, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
					[
						crypto.randomUUID(),
						actLineId,
						seqRows[0].message_id,
						seqRows[0].sequence,
						'plot-generated',
						String(row.last_plot_generation),
						now,
					]
				);
			}
		}

		if (row.ending_type !== null) {
			const lastMsg = await db.select<ActLineEntryMigrateRow[]>(
				'SELECT message_id, sequence FROM act_lines WHERE act_line_id = $1 ORDER BY sequence DESC LIMIT 1',
				[actLineId]
			);
			if (lastMsg.length > 0) {
				await db.execute(
					'INSERT INTO act_line_events (id, act_line_id, message_id, message_sequence, event, value, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
					[crypto.randomUUID(), actLineId, lastMsg[0].message_id, lastMsg[0].sequence, 'ending', row.ending_type, row.ended_at ?? now]
				);
			}
		}

		if (row.epilogue_written_at !== null) {
			const lastMsg = await db.select<ActLineEntryMigrateRow[]>(
				'SELECT message_id, sequence FROM act_lines WHERE act_line_id = $1 ORDER BY sequence DESC LIMIT 1',
				[actLineId]
			);
			if (lastMsg.length > 0) {
				await db.execute(
					'INSERT INTO act_line_events (id, act_line_id, message_id, message_sequence, event, value, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
					[crypto.randomUUID(), actLineId, lastMsg[0].message_id, lastMsg[0].sequence, 'epilogue-written', null, row.epilogue_written_at]
				);
			}
		}
	}

	try {
		await db.execute('ALTER TABLE act_line_meta DROP COLUMN last_plot_generation');
		await db.execute('ALTER TABLE act_line_meta DROP COLUMN act_phase');
		await db.execute('ALTER TABLE act_line_meta DROP COLUMN ended_at');
		await db.execute('ALTER TABLE act_line_meta DROP COLUMN ending_type');
		await db.execute('ALTER TABLE act_line_meta DROP COLUMN epilogue_written_at');
	} catch {
		// SQLite < 3.35.0 doesn't support DROP COLUMN; columns remain as dead weight
	}
}

const postMigrationHooks: Record<number, () => Promise<void>> = {
	9: migrateV9Data,
};

export async function runMigrations(): Promise<void> {
	const db = getDatabase();

	await db.execute(`
		CREATE TABLE IF NOT EXISTS schema_version (
			version INTEGER PRIMARY KEY
		)
	`);

	const result = await db.select<SchemaVersion[]>('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1');
	const currentVersion = result.length > 0 ? result[0].version : 0;

	for (let i = currentVersion; i < migrationStatements.length; i++) {
		for (const stmt of migrationStatements[i]) {
			await db.execute(stmt);
		}

		await db.execute('INSERT INTO schema_version (version) VALUES ($1)', [i + 1]);

		const hook = postMigrationHooks[i + 1];
		if (hook) await hook();
	}
}
