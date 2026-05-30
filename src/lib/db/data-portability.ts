import { getDatabase } from '$lib/db/database';

/**
 * Export the entire database as a binary Uint8Array.
 * - SqlJsDatabase: returns the raw SQLite binary (via .export())
 * - TauriDatabase: returns a JSON-serialized dump of all tables
 */
export async function exportDatabase(): Promise<Uint8Array> {
	const db = getDatabase();

	if ('export' in db && typeof db.export === 'function') {
		return (db as { export: () => Uint8Array }).export();
	}

	// TauriDatabase: serialize all tables to JSON
	const tables = await db.select<Array<{ name: string }>>(
		"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream_%'"
	);

	const data: Record<string, unknown[]> = {};
	for (const { name } of tables) {
		data[name] = await db.select(`SELECT * FROM "${name}"`);
	}

	const encoder = new TextEncoder();
	return encoder.encode(JSON.stringify(data));
}

/**
 * Import a previously exported database.
 * Overwrites all current data with the import data.
 * The app must be reloaded after import to re-initialize state.
 */
export async function importDatabase(data: Uint8Array): Promise<void> {
	const db = getDatabase();

	// For SqlJsDatabase: replace the in-memory database with the imported data
	if ('importFromData' in db && typeof (db as any).importFromData === 'function') {
		await (db as any).importFromData(data);
		await db.flush();
		return;
	}

	// Fallback: JSON format for TauriDatabase
	const decoder = new TextDecoder();
	const json = JSON.parse(decoder.decode(data)) as Record<string, unknown[]>;

	// Disable foreign keys during import
	await db.execute('PRAGMA foreign_keys = OFF');

	try {
		// Drop existing tables
		const tables = await db.select<Array<{ name: string }>>(
			"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream_%'"
		);
		for (const { name } of tables) {
			await db.execute(`DROP TABLE IF EXISTS "${name}"`);
		}

		// Re-run migrations to create schema
		const { runMigrations } = await import('$lib/db/migrations');
		await runMigrations();

		// Insert data
		for (const [tableName, rows] of Object.entries(json)) {
			if (!Array.isArray(rows) || rows.length === 0) continue;

			const columns = Object.keys(rows[0] as Record<string, unknown>);
			const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
			const colNames = columns.map((c) => `"${c}"`).join(', ');

			for (const row of rows) {
				const record = row as Record<string, unknown>;
				const values = columns.map((c) => record[c] ?? null);
				await db.execute(`INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})`, values);
			}
		}
	} finally {
		await db.execute('PRAGMA foreign_keys = ON');
	}

	await db.flush();
}

/**
 * Trigger a browser download of the database export.
 */
export function downloadExport(data: Uint8Array, filename: string): void {
	const blob = new Blob([data.buffer as ArrayBuffer], { type: 'application/octet-stream' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

/**
 * Read a File as Uint8Array.
 */
export function readFileAsUint8Array(file: File): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			if (reader.result instanceof ArrayBuffer) {
				resolve(new Uint8Array(reader.result));
			} else {
				reject(new Error('Failed to read file'));
			}
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsArrayBuffer(file);
	});
}

/**
 * Whether the current database supports binary export/import (SqlJsDatabase).
 * TauriDatabase uses JSON serialization.
 */
export function isBinaryFormat(): boolean {
	const db = getDatabase();
	return 'export' in db && typeof db.export === 'function';
}
