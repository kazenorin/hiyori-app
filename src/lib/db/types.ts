export type BindValue = string | number | boolean | null | undefined;

export interface QueryResult {
	rowsAffected: number;
	lastInsertId?: number;
}

export interface Database {
	select<T>(query: string, bindValues?: unknown[]): Promise<T>;

	execute(query: string, bindValues?: unknown[]): Promise<QueryResult>;

	close(): void;
}
