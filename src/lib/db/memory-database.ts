import Database from '@tauri-apps/plugin-sql';
import { ERR_MEMORY_DB_NOT_INITIALIZED } from '$lib/definitions/error-messages';

let memoryDb: Database | null = null;

export async function initMemoryDatabase(): Promise<Database> {
	if (memoryDb) return memoryDb;

	memoryDb = await Database.load('sqlite:byoa-memory.db');
	return memoryDb;
}

export function getMemoryDatabase(): Database {
	if (!memoryDb) {
		throw new Error(ERR_MEMORY_DB_NOT_INITIALIZED);
	}
	return memoryDb;
}
