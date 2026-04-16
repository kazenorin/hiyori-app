import { getMemoryDatabase } from './memory-database';

interface SchemaVersion {
	version: number;
}

const memoryMigrationStatements: string[][] = [
	[
		`CREATE TABLE IF NOT EXISTS memory_config (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS memory_meta (
			id TEXT PRIMARY KEY,
			vec_rowid INTEGER UNIQUE,
			content TEXT NOT NULL,
			story_id TEXT NOT NULL,
			act_line_id TEXT NOT NULL,
			character_canonical_name TEXT NOT NULL,
			location TEXT NOT NULL,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_memory_meta_story ON memory_meta(story_id)`,
		`CREATE INDEX IF NOT EXISTS idx_memory_meta_act_line ON memory_meta(act_line_id)`,
		`CREATE INDEX IF NOT EXISTS idx_memory_meta_character ON memory_meta(character_canonical_name)`
	],
	[
		`CREATE TABLE IF NOT EXISTS location_meta (
			id TEXT PRIMARY KEY,
			vec_rowid INTEGER UNIQUE,
			location_text TEXT NOT NULL,
			story_id TEXT NOT NULL,
			act_line_id TEXT NOT NULL,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_location_meta_story ON location_meta(story_id)`,
		`CREATE INDEX IF NOT EXISTS idx_location_meta_act_line ON location_meta(act_line_id)`
	]
];

export async function runMemoryMigrations(): Promise<void> {
	const db = getMemoryDatabase();

	await db.execute(`
		CREATE TABLE IF NOT EXISTS schema_version (
			version INTEGER PRIMARY KEY
		)
	`);

	const result = await db.select<SchemaVersion[]>(
		'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1'
	);
	const currentVersion = result.length > 0 ? result[0].version : 0;

	for (let i = currentVersion; i < memoryMigrationStatements.length; i++) {
		for (const stmt of memoryMigrationStatements[i]) {
			await db.execute(stmt);
		}

		await db.execute('INSERT INTO schema_version (version) VALUES ($1)', [i + 1]);
	}
}
