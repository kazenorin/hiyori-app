import { TauriDatabase } from './adapters/tauri-database';
import type { Database } from './types';
import { ERR_DB_NOT_INITIALIZED } from '$lib/definitions/error-messages';

let db: Database | null = null;

export async function initDatabase(): Promise<Database> {
	if (db) return db;

	db = await TauriDatabase.create('sqlite:byoa.db');
	return db;
}

export function getDatabase(): Database {
	if (!db) {
		throw new Error(ERR_DB_NOT_INITIALIZED);
	}
	return db;
}
