import { isTauri } from '@tauri-apps/api/core';
import { TauriDatabase } from './adapters/tauri-database';
import { SqlJsDatabase } from './adapters/sqljs-database';
import type { Database } from './types';
import { ERR_MEMORY_DB_NOT_INITIALIZED } from '$lib/definitions/error-messages';

let memoryDb: Database | null = null;
let memoryDbInit: Promise<Database> | null = null;

function checkIsTauri(): boolean {
	try {
		return isTauri();
	} catch {
		return false;
	}
}

export async function initMemoryDatabase(): Promise<Database> {
	if (memoryDb) return memoryDb;
	if (memoryDbInit) return memoryDbInit;

	memoryDbInit = (async () => {
		if (checkIsTauri()) {
			memoryDb = await TauriDatabase.create('sqlite:byoa-memory.db');
		} else {
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
