import { checkIsTauri } from '$lib/runtime';
import type { Database } from './types';
import { ERR_DB_NOT_INITIALIZED } from '$lib/definitions/error-messages';

let db: Database | null = null;
let dbInit: Promise<Database> | null = null;

export async function initDatabase(): Promise<Database> {
	if (db) return db;
	if (dbInit) return dbInit;

	dbInit = (async () => {
		if (await checkIsTauri()) {
			const { TauriDatabase } = await import('./adapters/tauri-database');
			db = await TauriDatabase.create('sqlite:hiyori.db');
		} else {
			const { SqlJsDatabase } = await import('./adapters/sqljs-database');
			const { loadFromOpfs } = await import('./adapters/opfs-persistence');
			const existingData = await loadFromOpfs('hiyori.db.bin');
			db = await SqlJsDatabase.create(existingData, {
				persistToOpfs: true,
				opfsFilename: 'hiyori.db.bin',
			});
		}
		dbInit = null;
		return db;
	})();

	return dbInit;
}

export function getDatabase(): Database {
	if (!db) {
		throw new Error(ERR_DB_NOT_INITIALIZED);
	}
	return db;
}
