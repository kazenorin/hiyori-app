import BetterSqlite3 from 'better-sqlite3';
import type { Database, QueryResult } from '$lib/db/types';

function convertParams(query: string, params: unknown[]): [string, unknown[]] {
	const expanded: unknown[] = [];
	const sql = query.replace(/\$(\d+)/g, (_, numStr: string) => {
		expanded.push(params[parseInt(numStr) - 1]);
		return '?';
	});
	return [sql, expanded];
}

export function createTestDatabase(): Database & { _db: BetterSqlite3.Database } {
	const db = new BetterSqlite3(':memory:');
	db.pragma('journal_mode = WAL');

	return {
		_db: db,

		async select<T>(query: string, bindValues?: unknown[]): Promise<T> {
			const params = bindValues ?? [];
			const [sql, expanded] = convertParams(query, params);
			const stmt = db.prepare(sql);
			const result = stmt.all(...expanded) as T;
			return result;
		},

		async execute(query: string, bindValues?: unknown[]): Promise<QueryResult> {
			const params = bindValues ?? [];
			const [sql, expanded] = convertParams(query, params);
			const stmt = db.prepare(sql);
			const method = stmt.reader ? 'all' : 'run';
			const result = stmt[method](...expanded);
			if (method === 'all') {
				return { rowsAffected: (result as unknown[]).length, lastInsertId: undefined };
			}
			const runResult = result as BetterSqlite3.RunResult;
			return { rowsAffected: runResult.changes, lastInsertId: runResult.lastInsertRowid as number | undefined };
		},

		close() {
			db.close();
		},
	};
}
