import { vi } from 'vitest';
import type { Database, QueryResult } from '$lib/db/types';

export function createMockDatabase(): Database & {
	getTables: () => Map<string, any[]>;
	seed: (tableName: string, rows: any[]) => void;
	clear: () => void;
} {
	const tables = new Map<string, any[]>();

	return {
		execute: vi.fn(async (query: string, params?: unknown[]): Promise<QueryResult> => {
			const normalized = query.trim().toUpperCase();

			if (normalized.startsWith('SELECT')) {
				return { rowsAffected: 0 };
			}

			if (normalized.startsWith('INSERT')) {
				insert(query, params);
				return { rowsAffected: 1, lastInsertId: undefined };
			}

			if (normalized.startsWith('UPDATE')) {
				const count = update(query, params);
				return { rowsAffected: count };
			}

			if (normalized.startsWith('DELETE')) {
				const count = deleteRows(query, params);
				return { rowsAffected: count };
			}

			if (normalized.startsWith('CREATE') || normalized.startsWith('ALTER') || normalized.startsWith('DROP')) {
				return { rowsAffected: 0 };
			}

			return { rowsAffected: 0 };
		}),

		select: vi.fn(async (query: string, params?: unknown[]) => {
			return select(query, params);
		}) as unknown as Database['select'],

		close: vi.fn(() => {}),

		getTables: () => tables,

		seed(tableName: string, rows: any[]) {
			tables.set(tableName, [...rows]);
		},

		clear() {
			tables.clear();
		},
	};

	function select(query: string, params?: unknown[]) {
		const fromMatch = query.match(/FROM\s+(\w+)/i);
		if (!fromMatch) return [];

		const tableName = fromMatch[1];
		const rows = tables.get(tableName) ?? [];

		const whereMatch = query.match(/WHERE\s+(\w+)\s*=\s*\$(\d+)/i);
		if (whereMatch && params) {
			const col = whereMatch[1];
			const paramIdx = parseInt(whereMatch[2]) - 1;
			const value = params[paramIdx];
			return rows.filter((r) => r[col] === value);
		}

		const maxMatch = query.match(/MAX\((\w+)\)/i);
		if (maxMatch) {
			const col = maxMatch[1];
			if (rows.length === 0) return [{ [`MAX(${col})`]: null }];
			const maxVal = Math.max(...rows.map((r) => r[col] ?? 0));
			return [{ [`MAX(${col})`]: maxVal }];
		}

		if (query.match(/ORDER BY/i)) {
			const orderMatch = query.match(/ORDER BY\s+(\w+)\s*(ASC|DESC)?/i);
			if (orderMatch) {
				const col = orderMatch[1];
				const dir = (orderMatch[2] ?? 'ASC').toUpperCase();
				const sorted = [...rows].sort((a, b) => {
					const av = a[col] ?? 0;
					const bv = b[col] ?? 0;
					return dir === 'DESC' ? (bv as number) - (av as number) : (av as number) - (bv as number);
				});
				return sorted;
			}
		}

		return [...rows];
	}

	function insert(query: string, params?: unknown[]) {
		const intoMatch = query.match(/INTO\s+(\w+)/i);
		if (!intoMatch || !params) return;

		const tableName = intoMatch[1];
		if (!tables.has(tableName)) {
			tables.set(tableName, []);
		}

		const colsMatch = query.match(/\(([^)]+)\)/);
		if (colsMatch) {
			const cols = colsMatch[1].split(',').map((c) => c.trim());
			const row: Record<string, unknown> = {};
			cols.forEach((col, i) => {
				row[col] = params[i] ?? null;
			});
			tables.get(tableName)!.push(row);
		}
	}

	function update(query: string, params?: unknown[]): number {
		const tableMatch = query.match(/UPDATE\s+(\w+)/i);
		if (!tableMatch || !params) return 0;

		const tableName = tableMatch[1];
		const rows = tables.get(tableName);
		if (!rows) return 0;

		let count = 0;
		const setMatch = query.match(/SET\s+(.+?)(?:\s+WHERE|$)/is);
		const whereMatch = query.match(/WHERE\s+(\w+)\s*=\s*\$(\d+)/i);

		if (setMatch) {
			const setClauses = setMatch[1].split(',').map((s) => s.trim());
			const assignments: { col: string; paramIdx: number }[] = [];
			setClauses.forEach((clause) => {
				const m = clause.match(/(\w+)\s*=\s*\$(\d+)/);
				if (m) assignments.push({ col: m[1], paramIdx: parseInt(m[2]) - 1 });
			});

			rows.forEach((row) => {
				if (whereMatch) {
					const whereCol = whereMatch[1];
					const whereIdx = parseInt(whereMatch[2]) - 1;
					if (row[whereCol] !== params[whereIdx]) return;
				}
				assignments.forEach(({ col, paramIdx }) => {
					row[col] = params[paramIdx];
				});
				count++;
			});
		}
		return count;
	}

	function deleteRows(query: string, params?: unknown[]): number {
		const fromMatch = query.match(/FROM\s+(\w+)/i);
		if (!fromMatch || !params) return 0;

		const tableName = fromMatch[1];
		const rows = tables.get(tableName);
		if (!rows) return 0;

		const whereMatch = query.match(/WHERE\s+(\w+)\s*=\s*\$(\d+)/i);
		if (whereMatch) {
			const col = whereMatch[1];
			const paramIdx = parseInt(whereMatch[2]) - 1;
			const value = params[paramIdx];
			const before = rows.length;
			const filtered = rows.filter((r) => r[col] !== value);
			tables.set(tableName, filtered);
			return before - filtered.length;
		}
		const before = rows.length;
		tables.set(tableName, []);
		return before;
	}
}
