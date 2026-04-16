import { embed, embedMany } from 'ai';
import { getMemoryDatabase } from '$lib/db/memory-database';
import { createEmbeddingModel } from '$lib/ai/provider';
import type { ProviderConfig } from '$lib/stores/settings.svelte';

export interface MemorySearchOptions {
	storyId: string;
	limit?: number;
}

export interface MemoryItem {
	id: string;
	memory: string;
	score?: number;
	storyId: string;
	actLineId: string;
	characterCanonicalName: string;
	location: string;
	createdAt?: string;
}

interface MemoryMetaRow {
	id: string;
	content: string;
	story_id: string;
	act_line_id: string;
	character_canonical_name: string;
	location: string;
	created_at: string;
	distance?: number;
}

interface LocationMetaRow {
	id: string;
	location_text: string;
	story_id: string;
	act_line_id: string;
	created_at: string;
	distance?: number;
}

interface VecRow {
	rowid: number;
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return 'Unexpected error';
}

export class Memory {
	private readonly providerConfig: ProviderConfig;
	private vecDimension: number | null = null;
	private locVecDimension: number | null = null;

	constructor(providerConfig: ProviderConfig) {
		this.providerConfig = providerConfig;
	}

	private async generateEmbedding(text: string): Promise<number[]> {
		const model = createEmbeddingModel(this.providerConfig);
		const result = await embed({ model, value: text });
		return result.embedding;
	}

	private async generateEmbeddings(texts: string[]): Promise<number[][]> {
		const model = createEmbeddingModel(this.providerConfig);
		const result = await embedMany({ model, values: texts });
		return result.embeddings;
	}

	private async ensureMemoryVecTable(dimension: number): Promise<void> {
		const db = getMemoryDatabase();

		await db.execute(`
			CREATE TABLE IF NOT EXISTS memory_config (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			)
		`);

		const tables = await db.select<Array<{ name: string }>>(
			"SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table') AND name = 'vec_memories'"
		);
		if (tables.length > 0) {
			const configRows = await db.select<Array<{ value: string }>>(
				"SELECT value FROM memory_config WHERE key = 'vec_dimension'"
			);
			const storedDimension = configRows.length > 0 ? parseInt(configRows[0].value, 10) : null;
			if (storedDimension !== null && storedDimension !== dimension) {
				throw new Error(
					`Embedding dimension mismatch: existing table uses ${storedDimension}, but current model produces ${dimension}. Reset memory to switch embedding models.`
				);
			}
			this.vecDimension = dimension;
			return;
		}

		try {
			await db.execute(
				`CREATE VIRTUAL TABLE vec_memories USING vec0(embedding float[${dimension}])`
			);
		} catch (err) {
			if (err instanceof Error && err.message.includes('no such module: vec0')) {
				await db.execute(`
					CREATE TABLE vec_memories (
						rowid INTEGER PRIMARY KEY AUTOINCREMENT,
						embedding TEXT NOT NULL
					)
				`);
			} else {
				throw err;
			}
		}

		await db.execute(
			"INSERT INTO memory_config (key, value) VALUES ('vec_dimension', $1) ON CONFLICT(key) DO UPDATE SET value = $1",
			[String(dimension)]
		);
		this.vecDimension = dimension;
	}

	private async ensureLocationVecTable(dimension: number): Promise<void> {
		const db = getMemoryDatabase();

		const tables = await db.select<Array<{ name: string }>>(
			"SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table') AND name = 'vec_locations'"
		);
		if (tables.length > 0) {
			this.locVecDimension = dimension;
			return;
		}

		try {
			await db.execute(
				`CREATE VIRTUAL TABLE vec_locations USING vec0(embedding float[${dimension}])`
			);
		} catch (err) {
			if (err instanceof Error && err.message.includes('no such module: vec0')) {
				await db.execute(`
					CREATE TABLE vec_locations (
						rowid INTEGER PRIMARY KEY AUTOINCREMENT,
						embedding TEXT NOT NULL
					)
				`);
			} else {
				throw err;
			}
		}

		this.locVecDimension = dimension;
	}

	async add(
		storyId: string,
		actLineId: string,
		characterCanonicalName: string,
		location: string,
		memories: string[]
	): Promise<void> {
		if (memories.length === 0) return;

		const db = getMemoryDatabase();
		const embeddings = memories.length === 1
			? [await this.generateEmbedding(memories[0])]
			: await this.generateEmbeddings(memories);

		const dimension = embeddings[0].length;
		await this.ensureMemoryVecTable(dimension);

		for (let i = 0; i < memories.length; i++) {
			const id = crypto.randomUUID();
			const text = memories[i];
			const embedding = embeddings[i];

			await db.execute(
				'INSERT INTO vec_memories(embedding) VALUES ($1)',
				[JSON.stringify(embedding)]
			);

			const rowResult = await db.select<VecRow[]>('SELECT last_insert_rowid() as rowid');
			const vecRowid = rowResult[0]?.rowid;

			if (!vecRowid) {
				throw new Error('Failed to retrieve vector rowid after insert');
			}

			await db.execute(
				`INSERT INTO memory_meta (
					id, vec_rowid, content, story_id, act_line_id, character_canonical_name, location
				) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				[id, vecRowid, text, storyId, actLineId, characterCanonicalName, location]
			);
		}
	}

	async addLocation(
		storyId: string,
		actLineId: string,
		location: string
	): Promise<void> {
		const db = getMemoryDatabase();
		const embedding = await this.generateEmbedding(location);
		const dimension = embedding.length;
		await this.ensureLocationVecTable(dimension);

		const id = crypto.randomUUID();

		await db.execute(
			'INSERT INTO vec_locations(embedding) VALUES ($1)',
			[JSON.stringify(embedding)]
		);

		const rowResult = await db.select<VecRow[]>('SELECT last_insert_rowid() as rowid');
		const vecRowid = rowResult[0]?.rowid;

		if (!vecRowid) {
			throw new Error('Failed to retrieve location vector rowid after insert');
		}

		await db.execute(
			`INSERT INTO location_meta (id, vec_rowid, location_text, story_id, act_line_id)
			VALUES ($1, $2, $3, $4, $5)`,
			[id, vecRowid, location, storyId, actLineId]
		);
	}

	async search(query: string, options: MemorySearchOptions): Promise<MemoryItem[]> {
		const db = getMemoryDatabase();
		const embedding = await this.generateEmbedding(query);
		const dimension = embedding.length;
		await this.ensureMemoryVecTable(dimension);
		const limit = options.limit ?? 5;

		const sql = `
			SELECT m.id, m.content, m.story_id, m.act_line_id, m.character_canonical_name, m.location, m.created_at, sub.distance
			FROM (
				SELECT rowid, distance
				FROM vec_memories
				WHERE embedding MATCH $1
				ORDER BY distance
				LIMIT $2
			) sub
			JOIN memory_meta m ON m.vec_rowid = sub.rowid
			WHERE m.story_id = $3
			ORDER BY sub.distance
		`;

		const rows = await db.select<MemoryMetaRow[]>(sql, [
			JSON.stringify(embedding),
			limit,
			options.storyId
		]);

		return rows.map((row) => ({
			id: row.id,
			memory: row.content,
			score: row.distance,
			storyId: row.story_id,
			actLineId: row.act_line_id,
			characterCanonicalName: row.character_canonical_name,
			location: row.location,
			createdAt: row.created_at
		}));
	}

	async delete(id: string): Promise<void> {
		const db = getMemoryDatabase();

		const rows = await db.select<VecRow[]>(
			'SELECT vec_rowid as rowid FROM memory_meta WHERE id = $1',
			[id]
		);
		const vecRowid = rows[0]?.rowid;

		if (vecRowid) {
			await db.execute('DELETE FROM vec_memories WHERE rowid = $1', [vecRowid]);
		}

		await db.execute('DELETE FROM memory_meta WHERE id = $1', [id]);
	}

	async reset(): Promise<void> {
		const db = getMemoryDatabase();
		await db.execute('DELETE FROM vec_memories');
		await db.execute('DELETE FROM memory_meta');
		await db.execute('DELETE FROM vec_locations');
		await db.execute('DELETE FROM location_meta');
	}
}
