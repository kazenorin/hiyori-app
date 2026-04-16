import Database from '@tauri-apps/plugin-sql';

let memoryDb: Database | null = null;

export async function initMemoryDatabase(): Promise<Database> {
	if (memoryDb) return memoryDb;

	memoryDb = await Database.load('sqlite:byoa-memory.db');
	return memoryDb;
}

export function getMemoryDatabase(): Database {
	if (!memoryDb) {
		throw new Error('Memory database not initialized. Call initMemoryDatabase() first.');
	}
	return memoryDb;
}
