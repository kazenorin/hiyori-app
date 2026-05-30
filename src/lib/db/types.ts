export type BindValue = string | number | boolean | null | undefined;

export interface QueryResult {
	rowsAffected: number;
	lastInsertId?: number;
}

export interface Database {
	select<T>(query: string, bindValues?: unknown[]): Promise<T>;

	execute(query: string, bindValues?: unknown[]): Promise<QueryResult>;

	close(): void;

	flush(): Promise<void>;

	/**
	 * Whether sqlite-vec (vec0 virtual table module) is available.
	 * TauriDatabase: true (loaded via Rust auto-extension).
	 * SqlJsDatabase: false (WASM SQLite cannot load native extensions).
	 */
	isSqliteVecAvailable(): boolean;
}
