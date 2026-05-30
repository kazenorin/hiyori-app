import type { Database as IDatabase, QueryResult } from '../types';
import { persistToOpfs } from './opfs-persistence';

type SqlJsParams = Record<string, string | number | boolean | null | Uint8Array> | (string | number | boolean | null | Uint8Array)[];

interface SqlJsDatabaseOptions {
	persistToOpfs?: boolean;
	opfsFilename?: string;
	locateWasm?: (file: string) => string;
}

export class SqlJsDatabase implements IDatabase {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private db: any;
	private options: SqlJsDatabaseOptions;
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private dirty = false;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private constructor(db: any, options: SqlJsDatabaseOptions) {
		this.db = db;
		this.options = options;
	}

	static async create(data?: ArrayLike<number> | null, options?: SqlJsDatabaseOptions): Promise<SqlJsDatabase> {
		const SQL = await loadSqlJs(options?.locateWasm);
		const db = new SQL.Database(data);
		db.run('PRAGMA journal_mode = WAL');

		return new SqlJsDatabase(db, options ?? {});
	}

	// SELECT queries don't mutate data, so no persistence flush needed
	async select<T>(query: string, bindValues?: unknown[]): Promise<T> {
		const params = this.convertParams(bindValues);
		const stmt = this.db.prepare(query);
		try {
			stmt.bind(params);
			const rows: Record<string, unknown>[] = [];
			while (stmt.step()) {
				rows.push(stmt.getAsObject());
			}
			return rows as T;
		} finally {
			stmt.free();
		}
	}

	async execute(query: string, bindValues?: unknown[]): Promise<QueryResult> {
		const upperQuery = query.trim().toUpperCase();

		if (upperQuery.startsWith('SELECT') || upperQuery.startsWith('PRAGMA')) {
			const params = this.convertParams(bindValues);
			const stmt = this.db.prepare(query);
			try {
				stmt.bind(params);
				const rows: Record<string, unknown>[] = [];
				while (stmt.step()) {
					rows.push(stmt.getAsObject());
				}
			} finally {
				stmt.free();
			}
			this.markDirty();
			return { rowsAffected: 0, lastInsertId: undefined };
		}

		const params = this.convertParams(bindValues);
		this.db.run(query, params);
		const rowsAffected = this.db.getRowsModified();
		this.markDirty();
		return { rowsAffected, lastInsertId: undefined };
	}

	close(): void {
		this.db.close();
	}

	markDirty(): void {
		this.dirty = true;
		this.scheduleFlush();
	}

	scheduleFlush(delayMs = 500): void {
		if (this.flushTimer) clearTimeout(this.flushTimer);
		this.flushTimer = setTimeout(() => {
			this.flush().catch((err: unknown) => {
				console.error('[SqlJsDatabase] Flush failed:', err);
			});
		}, delayMs);
	}

	async flush(): Promise<void> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		if (!this.dirty) return;
		this.dirty = false;

		if (this.options.persistToOpfs) {
			await persistToOpfs(this.db.export(), this.options.opfsFilename ?? 'byoa.db.bin');
		}
	}

	isSqliteVecAvailable(): boolean {
		return false;
	}

	export(): Uint8Array {
		return this.db.export();
	}

	/**
	 * Convert positional params[] to {$1: val1, $2: val2, …} named object for sql.js.
	 * sql.js uses $-prefixed keys ($1, $2) for named parameter binding.
	 * Note: better-sqlite3 (test helper) uses numeric keys (1, 2) without the $ prefix.
	 */
	private convertParams(bindValues?: unknown[]): SqlJsParams {
		if (!bindValues || bindValues.length === 0) return [];

		const named: Record<string, string | number | boolean | null | Uint8Array> = {};
		for (let i = 0; i < bindValues.length; i++) {
			const val = bindValues[i];
			const key = '$' + (i + 1);
			if (val === undefined) {
				named[key] = null;
			} else if (
				typeof val === 'string' ||
				typeof val === 'number' ||
				typeof val === 'boolean' ||
				val === null ||
				val instanceof Uint8Array
			) {
				named[key] = val;
			} else {
				named[key] = String(val);
			}
		}
		return named;
	}
}

async function loadSqlJs(locateWasm?: (file: string) => string) {
	const sqlJsModule = await import('sql.js');
	const initSqlJs: typeof import('sql.js') = sqlJsModule.default ?? sqlJsModule;

	const locateFile = locateWasm ?? ((file: string) => `/${file}`);

	return initSqlJs({ locateFile });
}
