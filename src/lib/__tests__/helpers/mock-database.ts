import { vi } from 'vitest';

/**
 * In-memory mock for @tauri-apps/plugin-sql Database.
 * Stores tables as Map<string, Map<string, any[]>> where the outer key is the table name.
 */
export function createMockDatabase() {
	const tables = new Map<string, any[]>();

	return {
		execute: vi.fn(async (query: string, params?: (string | number | boolean | null | undefined)[]) => {
			const normalized = query.trim().toUpperCase();

			// SELECT
			if (normalized.startsWith('SELECT')) {
				return { rows: select(query, params) };
			}

			// INSERT
			if (normalized.startsWith('INSERT')) {
				insert(query, params);
				return { rows: [] };
			}

			// UPDATE
			if (normalized.startsWith('UPDATE')) {
				update(query, params);
				return { rows: [] };
			}

			// DELETE
			if (normalized.startsWith('DELETE')) {
				deleteRows(query, params);
				return { rows: [] };
			}

			// CREATE TABLE, etc.
			if (normalized.startsWith('CREATE') || normalized.startsWith('ALTER') || normalized.startsWith('DROP')) {
				return { rows: [] };
			}

			return { rows: [] };
		}),

		select: vi.fn(async (query: string, params?: (string | number | boolean | null | undefined)[]) => {
			return select(query, params);
		}),

		getTables: () => tables,

		/** Seed a table with rows for testing. */
		seed(tableName: string, rows: any[]) {
			tables.set(tableName, [...rows]);
		},

		/** Clear all tables. */
		clear() {
			tables.clear();
		}
	};

	function select(query: string, params?: (string | number | boolean | null | undefined)[]) {
		// Extract table name from simple SELECT queries
		const fromMatch = query.match(/FROM\s+(\w+)/i);
		if (!fromMatch) return [];

		const tableName = fromMatch[1];
		const rows = tables.get(tableName) ?? [];

		// Extract WHERE column = $N
		const whereMatch = query.match(/WHERE\s+(\w+)\s*=\s*\$(\d+)/i);
		if (whereMatch && params) {
			const col = whereMatch[1];
			const paramIdx = parseInt(whereMatch[2]) - 1;
			const value = params[paramIdx];
			return rows.filter((r) => r[col] === value);
		}

		// MAX(col) aggregate
		const maxMatch = query.match(/MAX\((\w+)\)/i);
		if (maxMatch) {
			const col = maxMatch[1];
			if (rows.length === 0) return [{ [`MAX(${col})`]: null }];
			const maxVal = Math.max(...rows.map((r) => r[col] ?? 0));
			return [{ [`MAX(${col})`]: maxVal }];
		}

		// ORDER BY
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

	function insert(query: string, params?: (string | number | boolean | null | undefined)[]) {
		const intoMatch = query.match(/INTO\s+(\w+)/i);
		if (!intoMatch || !params) return;

		const tableName = intoMatch[1];
		if (!tables.has(tableName)) {
			tables.set(tableName, []);
		}

		// Extract column names from INSERT INTO table (col1, col2, ...)
		const colsMatch = query.match(/\(([^)]+)\)/);
		if (colsMatch) {
			const cols = colsMatch[1].split(',').map((c) => c.trim());
			const row: Record<string, any> = {};
			cols.forEach((col, i) => {
				row[col] = params[i] ?? null;
			});
			tables.get(tableName)!.push(row);
		}
	}

	function update(query: string, params?: (string | number | boolean | null | undefined)[]) {
		const tableMatch = query.match(/UPDATE\s+(\w+)/i);
		if (!tableMatch || !params) return;

		const tableName = tableMatch[1];
		const rows = tables.get(tableName);
		if (!rows) return;

		// Extract SET col1 = $N, col2 = $N
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
			});
		}
	}

	function deleteRows(query: string, params?: (string | number | boolean | null | undefined)[]) {
		const fromMatch = query.match(/FROM\s+(\w+)/i);
		if (!fromMatch || !params) return;

		const tableName = fromMatch[1];
		const rows = tables.get(tableName);
		if (!rows) return;

		const whereMatch = query.match(/WHERE\s+(\w+)\s*=\s*\$(\d+)/i);
		if (whereMatch) {
			const col = whereMatch[1];
			const paramIdx = parseInt(whereMatch[2]) - 1;
			const value = params[paramIdx];
			const filtered = rows.filter((r) => r[col] !== value);
			tables.set(tableName, filtered);
		} else {
			tables.set(tableName, []);
		}
	}
}
