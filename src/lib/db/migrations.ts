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
];

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
	}
}
