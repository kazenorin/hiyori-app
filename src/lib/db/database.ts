import { isTauri } from '@tauri-apps/api/core';
import { TauriDatabase } from './adapters/tauri-database';
import { SqlJsDatabase } from './adapters/sqljs-database';
import { loadFromOpfs } from './adapters/opfs-persistence';
import type { Database } from './types';
import { ERR_DB_NOT_INITIALIZED } from '$lib/definitions/error-messages';

let db: Database | null = null;

function checkIsTauri(): boolean {
	try {
		return isTauri();
	} catch {
		return false;
	}
}

export async function initDatabase(): Promise<Database> {
	if (db) return db;

	if (checkIsTauri()) {
		db = await TauriDatabase.create('sqlite:byoa.db');
	} else {
		const existingData = await loadFromOpfs('byoa.db.bin');
		db = await SqlJsDatabase.create(existingData, {
			persistToOpfs: true,
			opfsFilename: 'byoa.db.bin',
		});
	}

	return db;
}

export function getDatabase(): Database {
	if (!db) {
		throw new Error(ERR_DB_NOT_INITIALIZED);
	}
	return db;
}
