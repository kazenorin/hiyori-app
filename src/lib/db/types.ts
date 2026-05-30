export type BindValue = string | number | boolean | null | undefined;

export interface QueryResult {
	rowsAffected: number;
	lastInsertId?: number;
}

export interface Database {
	select<T>(query: string, bindValues?: unknown[]): Promise<T>;

	execute(query: string, bindValues?: unknown[]): Promise<QueryResult>;

	close(): void;

	/**
	 * Persist any buffered writes to durable storage. No-op for adapters
	 * that don't buffer (e.g. TauriDatabase). Must be called before close()
	 * in environments where data loss on shutdown is unacceptable.
	 */
	flush(): Promise<void>;
}
