import BetterSqlite3 from 'better-sqlite3';
import type { Database, QueryResult } from '$lib/db/types';

/**
 * Convert positional params[] to {1: val1, 2: val2, …} named object for better-sqlite3.
 * better-sqlite3 uses numeric keys (1, 2) without the $ prefix for $N placeholders.
 * Note: sql.js uses $-prefixed keys ($1, $2) for the same purpose.
 */
function convertParams(params: unknown[]): Record<string, unknown> | unknown[] {
	if (!params || params.length === 0) return [];
	const named: Record<string, unknown> = {};
	for (let i = 0; i < params.length; i++) {
		const key = String(i + 1);
		if (params[i] === undefined) {
			named[key] = null;
		} else {
			named[key] = params[i];
		}
	}
	return named;
}

export function createTestDatabase(): Database & { _db: BetterSqlite3.Database } {
	const db = new BetterSqlite3(':memory:');
	db.pragma('journal_mode = WAL');

	return {
		_db: db,

		async select<T>(query: string, bindValues?: unknown[]): Promise<T> {
			const params = convertParams(bindValues ?? []);
			const stmt = db.prepare(query);
			const result = stmt.all(params) as T;
			return result;
		},

		async execute(query: string, bindValues?: unknown[]): Promise<QueryResult> {
			const params = convertParams(bindValues ?? []);
			const stmt = db.prepare(query);
			const method = stmt.reader ? 'all' : 'run';
			const result = stmt[method](params);
			if (method === 'all') {
				return { rowsAffected: (result as unknown[]).length, lastInsertId: undefined };
			}
			const runResult = result as BetterSqlite3.RunResult;
			return { rowsAffected: runResult.changes, lastInsertId: runResult.lastInsertRowid as number | undefined };
		},

		close() {
			db.close();
		},

		async flush(): Promise<void> {
			// No-op: better-sqlite3 writes through immediately
		},

		isSqliteVecAvailable(): boolean {
			return true;
		},
	};
}
