import { checkIsTauri } from '$lib/runtime';
import type { Database } from './types';
import { ERR_MEMORY_DB_NOT_INITIALIZED } from '$lib/definitions/error-messages';

let memoryDb: Database | null = null;
let memoryDbInit: Promise<Database> | null = null;

export async function initMemoryDatabase(): Promise<Database> {
	if (memoryDb) return memoryDb;
	if (memoryDbInit) return memoryDbInit;

	memoryDbInit = (async () => {
		if (await checkIsTauri()) {
			const { TauriDatabase } = await import('./adapters/tauri-database');
			memoryDb = await TauriDatabase.create('sqlite:byoa-memory.db');
		} else {
			const { SqlJsDatabase } = await import('./adapters/sqljs-database');
			memoryDb = await SqlJsDatabase.create(null);
		}
		memoryDbInit = null;
		return memoryDb;
	})();

	return memoryDbInit;
}

export function getMemoryDatabase(): Database {
	if (!memoryDb) {
		throw new Error(ERR_MEMORY_DB_NOT_INITIALIZED);
	}
	return memoryDb;
}
