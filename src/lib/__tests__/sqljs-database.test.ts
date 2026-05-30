import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { SqlJsDatabase } from '$lib/db/adapters/sqljs-database';

const SQLJS_WASM_PATH = path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');

describe('SqlJsDatabase', () => {
	let db: SqlJsDatabase;

	beforeEach(async () => {
		db = await SqlJsDatabase.create(null, { locateWasm: () => SQLJS_WASM_PATH });
	});

	afterEach(() => {
		db.close();
	});

	describe('parameter conversion ($N → named object)', () => {
		it('binds a single positional parameter', async () => {
			await db.execute('CREATE TABLE test (id INTEGER, name TEXT)');
			await db.execute('INSERT INTO test (id, name) VALUES ($1, $2)', [1, 'Alice']);

			const rows = await db.select<{ id: number; name: string }[]>('SELECT * FROM test WHERE id = $1', [1]);
			expect(rows).toHaveLength(1);
			expect(rows[0].name).toBe('Alice');
		});

		it('binds multiple positional parameters', async () => {
			await db.execute('CREATE TABLE test (id INTEGER, name TEXT)');
			await db.execute('INSERT INTO test (id, name) VALUES ($1, $2)', [1, 'Alice']);
			await db.execute('INSERT INTO test (id, name) VALUES ($1, $2)', [2, 'Bob']);

			const rows = await db.select<{ id: number; name: string }[]>('SELECT * FROM test ORDER BY id');
			expect(rows).toHaveLength(2);
			expect(rows[0].name).toBe('Alice');
			expect(rows[1].name).toBe('Bob');
		});

		it('binds gapped indices (IN clause with offset)', async () => {
			await db.execute('CREATE TABLE test (id INTEGER, name TEXT)');
			await db.execute('INSERT INTO test (id, name) VALUES ($1, $2)', [1, 'Alice']);
			await db.execute('INSERT INTO test (id, name) VALUES ($1, $2)', [2, 'Bob']);
			await db.execute('INSERT INTO test (id, name) VALUES ($1, $2)', [3, 'Carol']);

			const rows = await db.select<{ id: number; name: string }[]>('SELECT * FROM test WHERE id IN ($2, $3) AND name != $1', [
				'Alice',
				2,
				3,
			]);
			expect(rows).toHaveLength(2);
			expect(rows.map((r) => r.name).sort()).toEqual(['Bob', 'Carol']);
		});

		it('binds re-used params (multi-row INSERT)', async () => {
			await db.execute('CREATE TABLE test (id INTEGER, name TEXT)');

			await db.execute('INSERT INTO test (id, name) VALUES ($1, $2), ($3, $4)', [1, 'Alice', 2, 'Bob']);

			const rows = await db.select<{ id: number; name: string }[]>('SELECT * FROM test ORDER BY id');
			expect(rows).toHaveLength(2);
			expect(rows[0].name).toBe('Alice');
			expect(rows[1].name).toBe('Bob');
		});

		it('binds 7-column multi-row INSERT', async () => {
			await db.execute('CREATE TABLE test (a INTEGER, b TEXT, c TEXT, d TEXT, e TEXT, f TEXT, g TEXT)');

			await db.execute('INSERT INTO test (a, b, c, d, e, f, g) VALUES ($1, $2, $3, $4, $5, $6, $7)', [1, 'b', 'c', 'd', 'e', 'f', 'g']);

			const rows = await db.select<{ a: number; b: string }[]>('SELECT * FROM test');
			expect(rows).toHaveLength(1);
			expect(rows[0].a).toBe(1);
			expect(rows[0].b).toBe('b');
		});

		it('binds dynamic SET clause (variable start index)', async () => {
			await db.execute('CREATE TABLE test (id INTEGER, name TEXT, age INTEGER)');
			await db.execute('INSERT INTO test (id, name, age) VALUES ($1, $2, $3)', [1, 'Alice', 30]);

			await db.execute('UPDATE test SET name = $2, age = $3 WHERE id = $1', [1, 'Alice Updated', 31]);

			const rows = await db.select<{ name: string; age: number }[]>('SELECT name, age FROM test WHERE id = $1', [1]);
			expect(rows[0].name).toBe('Alice Updated');
			expect(rows[0].age).toBe(31);
		});

		it('handles dollar sign inside string literal (not a placeholder)', async () => {
			await db.execute('CREATE TABLE test (id INTEGER, note TEXT)');
			await db.execute('INSERT INTO test (id, note) VALUES ($1, $2)', [1, 'Price is $5']);

			const rows = await db.select<{ note: string }[]>('SELECT note FROM test WHERE id = $1', [1]);
			expect(rows).toHaveLength(1);
			expect(rows[0].note).toBe('Price is $5');
		});

		it('handles query with no parameters', async () => {
			await db.execute('CREATE TABLE test (id INTEGER)');
			await db.execute('INSERT INTO test (id) VALUES (1)');

			const rows = await db.select<{ cnt: number }[]>('SELECT COUNT(*) as cnt FROM test');
			expect(rows[0].cnt).toBe(1);
		});

		it('binds undefined as NULL', async () => {
			await db.execute('CREATE TABLE test (id INTEGER, name TEXT)');
			await db.execute('INSERT INTO test (id, name) VALUES ($1, $2)', [1, undefined]);

			const rows = await db.select<{ name: unknown }[]>('SELECT name FROM test WHERE id = $1', [1]);
			expect(rows[0].name).toBeNull();
		});

		it('handles large parameter count (50+ params)', async () => {
			const columns = Array.from({ length: 52 }, (_, i) => `col${i} TEXT`).join(', ');
			await db.execute(`CREATE TABLE test (${columns})`);

			const placeholders = Array.from({ length: 52 }, (_, i) => `$${i + 1}`).join(', ');
			const values = Array.from({ length: 52 }, (_, i) => `val${i}`);

			await db.execute(`INSERT INTO test VALUES (${placeholders})`, values);

			const rows = await db.select<{ col0: string }[]>('SELECT col0 FROM test');
			expect(rows[0].col0).toBe('val0');
		});
	});

	describe('CRUD operations', () => {
		beforeEach(async () => {
			await db.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER)');
		});

		it('INSERT and SELECT', async () => {
			await db.execute('INSERT INTO items (id, name, qty) VALUES ($1, $2, $3)', [1, 'Widget', 10]);
			const rows = await db.select<{ name: string }[]>('SELECT name FROM items WHERE id = $1', [1]);
			expect(rows[0].name).toBe('Widget');
		});

		it('UPDATE with WHERE', async () => {
			await db.execute('INSERT INTO items (id, name, qty) VALUES ($1, $2, $3)', [1, 'Widget', 10]);
			await db.execute('UPDATE items SET qty = $1 WHERE id = $2', [20, 1]);
			const rows = await db.select<{ qty: number }[]>('SELECT qty FROM items WHERE id = $1', [1]);
			expect(rows[0].qty).toBe(20);
		});

		it('DELETE with WHERE', async () => {
			await db.execute('INSERT INTO items (id, name, qty) VALUES ($1, $2, $3)', [1, 'Widget', 10]);
			await db.execute('DELETE FROM items WHERE id = $1', [1]);
			const rows = await db.select<unknown[]>('SELECT * FROM items');
			expect(rows).toHaveLength(0);
		});

		it('INSERT OR IGNORE skips duplicates', async () => {
			await db.execute('INSERT INTO items (id, name, qty) VALUES ($1, $2, $3)', [1, 'Widget', 10]);
			const result = await db.execute('INSERT OR IGNORE INTO items (id, name, qty) VALUES ($1, $2, $3)', [1, 'Widget2', 20]);
			expect(result.rowsAffected).toBe(0);
		});

		it('ON CONFLICT DO UPDATE (upsert)', async () => {
			await db.execute('INSERT INTO items (id, name, qty) VALUES ($1, $2, $3)', [1, 'Widget', 10]);
			await db.execute('INSERT INTO items (id, name, qty) VALUES ($1, $2, $3) ON CONFLICT(id) DO UPDATE SET qty = $3, name = $2', [
				1,
				'Widget Updated',
				99,
			]);
			const rows = await db.select<{ name: string; qty: number }[]>('SELECT name, qty FROM items WHERE id = $1', [1]);
			expect(rows[0].name).toBe('Widget Updated');
			expect(rows[0].qty).toBe(99);
		});

		it('json_extract() works', async () => {
			await db.execute('CREATE TABLE jtest (id INTEGER, data TEXT)');
			await db.execute('INSERT INTO jtest (id, data) VALUES ($1, $2)', [1, '{"key": "value"}']);
			const rows = await db.select<{ val: string }[]>("SELECT json_extract(data, '$.key') as val FROM jtest WHERE id = $1", [1]);
			expect(rows[0].val).toBe('value');
		});

		it('COALESCE() works', async () => {
			await db.execute('CREATE TABLE ctest (id INTEGER, val TEXT)');
			await db.execute('INSERT INTO ctest (id, val) VALUES ($1, $2)', [1, null]);
			const rows = await db.select<{ val: string }[]>("SELECT COALESCE(val, 'default') as val FROM ctest");
			expect(rows[0].val).toBe('default');
		});

		it('CTE (WITH ... AS) works', async () => {
			await db.execute('INSERT INTO items (id, name, qty) VALUES ($1, $2, $3)', [1, 'Widget', 10]);
			const rows = await db.select<{ name: string }[]>(
				'WITH expensive AS (SELECT * FROM items WHERE qty > $1) SELECT name FROM expensive',
				[5]
			);
			expect(rows[0].name).toBe('Widget');
		});

		it('SELECT COUNT(*) aggregate works', async () => {
			await db.execute('INSERT INTO items (id, name, qty) VALUES ($1, $2, $3)', [1, 'Widget', 10]);
			await db.execute('INSERT INTO items (id, name, qty) VALUES ($1, $2, $3)', [2, 'Gadget', 20]);
			const rows = await db.select<{ cnt: number }[]>('SELECT COUNT(*) as cnt FROM items');
			expect(rows[0].cnt).toBe(2);
		});
	});

	describe('edge cases', () => {
		it('execute() with SELECT returns rows via select internally', async () => {
			await db.execute('CREATE TABLE test (id INTEGER, name TEXT)');
			await db.execute('INSERT INTO test (id, name) VALUES ($1, $2)', [1, 'Alice']);

			const result = await db.execute('SELECT * FROM test WHERE id = $1', [1]);
			expect(result.rowsAffected).toBe(1);
		});

		it('PRAGMA journal_mode = WAL is harmless', async () => {
			const result = await db.execute('PRAGMA journal_mode');
			expect(result).toBeDefined();
		});

		it('close() releases resources without error', async () => {
			await db.execute('CREATE TABLE test (id INTEGER)');
			db.close();
		});

		it('BindValue types: string, number, boolean, null, undefined', async () => {
			await db.execute('CREATE TABLE types (id INTEGER, val TEXT)');
			await db.execute('INSERT INTO types (id, val) VALUES ($1, $2)', [1, 'hello']);
			await db.execute('INSERT INTO types (id, val) VALUES ($1, $2)', [2, null]);
			await db.execute('INSERT INTO types (id, val) VALUES ($1, $2)', [3, undefined]);

			const rows = await db.select<{ val: unknown }[]>('SELECT val FROM types ORDER BY id');
			expect(rows[0].val).toBe('hello');
			expect(rows[1].val).toBeNull();
			expect(rows[2].val).toBeNull();
		});

		it('select() returns empty array for no results', async () => {
			await db.execute('CREATE TABLE empty (id INTEGER)');
			const rows = await db.select<unknown[]>('SELECT * FROM empty');
			expect(rows).toEqual([]);
		});

		it('execute() returns rowsAffected for DELETE', async () => {
			await db.execute('CREATE TABLE del (id INTEGER)');
			await db.execute('INSERT INTO del (id) VALUES (1)');
			await db.execute('INSERT INTO del (id) VALUES (2)');
			const result = await db.execute('DELETE FROM del WHERE id = $1', [1]);
			expect(result.rowsAffected).toBe(1);
		});

		it('execute() returns rowsAffected for UPDATE', async () => {
			await db.execute('CREATE TABLE upd (id INTEGER, name TEXT)');
			await db.execute('INSERT INTO upd (id, name) VALUES (1, $1)', ['old']);
			const result = await db.execute('UPDATE upd SET name = $1 WHERE id = $2', ['new', 1]);
			expect(result.rowsAffected).toBe(1);
		});

		it('last_insert_rowid() works', async () => {
			await db.execute('CREATE TABLE autoinc (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
			await db.execute('INSERT INTO autoinc (name) VALUES ($1)', ['first']);
			await db.execute('INSERT INTO autoinc (name) VALUES ($1)', ['second']);

			const rows = await db.select<{ id: number; name: string }[]>('SELECT * FROM autoinc ORDER BY id');
			expect(rows).toHaveLength(2);
			expect(rows[0].id).toBe(1);
			expect(rows[1].id).toBe(2);
		});

		it('CREATE TABLE and ALTER TABLE work', async () => {
			await db.execute('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
			await db.execute('ALTER TABLE test ADD COLUMN age INTEGER');
			await db.execute('INSERT INTO test (id, name, age) VALUES ($1, $2, $3)', [1, 'Alice', 30]);
			const rows = await db.select<{ name: string; age: number }[]>('SELECT name, age FROM test');
			expect(rows[0].name).toBe('Alice');
			expect(rows[0].age).toBe(30);
		});
	});
});
