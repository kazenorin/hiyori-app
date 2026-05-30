import Database from '@tauri-apps/plugin-sql';
import type { Database as IDatabase, QueryResult } from '../types';

export class TauriDatabase implements IDatabase {
	private db: Database;

	private constructor(db: Database) {
		this.db = db;
	}

	static async create(filename: string): Promise<TauriDatabase> {
		const db = await Database.load(filename);
		return new TauriDatabase(db);
	}

	async select<T>(query: string, bindValues?: unknown[]): Promise<T> {
		return this.db.select<T>(query, bindValues);
	}

	async execute(query: string, bindValues?: unknown[]): Promise<QueryResult> {
		return this.db.execute(query, bindValues);
	}

	close(): void {
		this.db.close();
	}
}
