import Database from 'better-sqlite3';
import type { Database as TauriDatabase } from '@tauri-apps/plugin-sql';

/**
 * Creates a real in-memory SQLite database that mimics the Tauri plugin-sql API.
 * This allows testing actual SQL queries without needing the Tauri runtime.
 */
export function createTestDatabase(): TauriDatabase & { _db: Database.Database } {
	const db = new Database(':memory:');
	db.pragma('journal_mode = WAL');

	type BindValue = string | number | boolean | null | undefined;

	/** Convert $1,$2,... style params to positional ? and expand reused params. */
	function convertParams(query: string, params: BindValue[]): [string, BindValue[]] {
		const expanded: BindValue[] = [];
		const sql = query.replace(/\$(\d+)/g, (_, numStr: string) => {
			expanded.push(params[parseInt(numStr) - 1]); // $1 → params[0]
			return '?';
		});
		return [sql, expanded];
	}

	return {
		_db: db,

		execute<T = Record<string, unknown>>(
			query: string,
			bindValues?: BindValue[]
		): Promise<{ rows: T[] }> {
			try {
				const params = bindValues ?? [];
				const [sql, expanded] = convertParams(query, params);
				const stmt = db.prepare(sql);
				const method = stmt.reader ? 'all' : 'run';
				const result = stmt[method](...expanded);
				if (method === 'all') {
					return Promise.resolve({ rows: result as T[] });
				}
				return Promise.resolve({ rows: [] });
			} catch (err) {
				return Promise.reject(err);
			}
		},

		select<T = Record<string, unknown>>(
			query: string,
			bindValues?: BindValue[]
		): Promise<T[]> {
			try {
				const params = bindValues ?? [];
				const [sql, expanded] = convertParams(query, params);
				const stmt = db.prepare(sql);
				const result = stmt.all(...expanded);
				return Promise.resolve(result as T[]);
			} catch (err) {
				return Promise.reject(err);
			}
		},

		close() {
			db.close();
		}
	} as unknown as TauriDatabase & { _db: Database.Database };
}
