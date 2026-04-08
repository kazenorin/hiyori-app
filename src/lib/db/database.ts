import Database from '@tauri-apps/plugin-sql';

let db: Database | null = null;

export async function initDatabase(): Promise<Database> {
	if (db) return db;

	db = await Database.load('sqlite:byoa.db');
	return db;
}

export function getDatabase(): Database {
	if (!db) {
		throw new Error('Database not initialized. Call initDatabase() first.');
	}
	return db;
}
