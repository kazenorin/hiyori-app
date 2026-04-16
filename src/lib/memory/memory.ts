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
	private embeddingModel: ReturnType<typeof createEmbeddingModel> | null = null;
	private vecDimension: number | null = null;
	private locVecDimension: number | null = null;
	private cachedModelKey: string | null = null;

	constructor(providerConfig: ProviderConfig) {
		this.providerConfig = providerConfig;
	}

	private getModelCacheKey(): string {
		return `${this.providerConfig.provider}-${this.providerConfig.model}-${this.providerConfig.baseURL}`;
	}

	private getEmbeddingModel() {
		if (!this.embeddingModel) {
			this.embeddingModel = createEmbeddingModel(this.providerConfig);
		}
		return this.embeddingModel;
	}

	private async generateEmbedding(text: string): Promise<number[]> {
		const model = this.getEmbeddingModel();
		const result = await embed({ model, value: text });
		return result.embedding;
	}

	private async generateEmbeddings(texts: string[]): Promise<number[][]> {
		const model = this.getEmbeddingModel();
		const result = await embedMany({ model, values: texts });
		return result.embeddings;
	}

	private async ensureMemoryVecTable(dimension: number): Promise<void> {
		const db = getMemoryDatabase();
		const currentKey = this.getModelCacheKey();

		// Early return if table exists and model unchanged since last call
		if (this.vecDimension !== null && this.vecDimension === dimension && this.cachedModelKey === currentKey) {
			return;
		}

		// Check if table already exists
		const tables = await db.select<Array<{ name: string }>>(
			"SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table') AND name = 'vec_memories'"
		);
		if (tables.length > 0) {
			// Table exists — verify dimension and model match
			const allConfig = await db.select<Array<{ key: string; value: string }>>(
				"SELECT key, value FROM memory_config WHERE key IN ('vec_dimension', 'model_key')"
			);
			const storedDimension = allConfig.find(c => c.key === 'vec_dimension')?.value;
			const storedModelKey = allConfig.find(c => c.key === 'model_key')?.value;

			if (storedDimension && parseInt(storedDimension, 10) !== dimension) {
				throw new Error(
					`Embedding dimension mismatch: existing table uses ${storedDimension}, but current model produces ${dimension}. Reset memory to switch embedding models.`
				);
			}
			if (storedModelKey && storedModelKey !== currentKey) {
				// Model changed but dimension might be the same — still block to prevent mixed embeddings
				throw new Error(
					`Embedding model changed from "${storedModelKey}" to "${currentKey}". Reset memory to switch embedding models.`
				);
			}

			this.vecDimension = dimension;
			this.cachedModelKey = currentKey;
			return;
		}

		// Table doesn't exist — create it with partition keys
		try {
			await db.execute(
				`CREATE VIRTUAL TABLE vec_memories USING vec0(story_id TEXT PARTITION KEY, act_line_id TEXT PARTITION KEY, embedding float[${dimension}])`
			);
		} catch (err) {
			if (err instanceof Error && err.message.includes('no such module: vec0')) {
				await db.execute(`
					CREATE TABLE vec_memories (
						rowid INTEGER PRIMARY KEY AUTOINCREMENT,
						story_id TEXT NOT NULL,
						act_line_id TEXT NOT NULL,
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
		await db.execute(
			"INSERT INTO memory_config (key, value) VALUES ('model_key', $1) ON CONFLICT(key) DO UPDATE SET value = $1",
			[currentKey]
		);
		this.vecDimension = dimension;
		this.cachedModelKey = currentKey;
	}

	private async ensureLocationVecTable(dimension: number): Promise<void> {
		const db = getMemoryDatabase();
		const currentKey = this.getModelCacheKey();

		// Early return if table exists and model unchanged since last call
		if (this.locVecDimension !== null && this.locVecDimension === dimension && this.cachedModelKey === currentKey) {
			return;
		}

		const tables = await db.select<Array<{ name: string }>>(
			"SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table') AND name = 'vec_locations'"
		);
		if (tables.length > 0) {
			// Verify dimension and model match
			const allConfig = await db.select<Array<{ key: string; value: string }>>(
				"SELECT key, value FROM memory_config WHERE key IN ('loc_vec_dimension', 'loc_model_key')"
			);
			const storedDimension = allConfig.find(c => c.key === 'loc_vec_dimension')?.value;
			const storedModelKey = allConfig.find(c => c.key === 'loc_model_key')?.value;

			if (storedDimension && parseInt(storedDimension, 10) !== dimension) {
				throw new Error(
					`Location embedding dimension mismatch: existing table uses ${storedDimension}, but current model produces ${dimension}. Reset memory to switch embedding models.`
				);
			}
			if (storedModelKey && storedModelKey !== currentKey) {
				throw new Error(
					`Location embedding model changed from "${storedModelKey}" to "${currentKey}". Reset memory to switch embedding models.`
				);
			}

			this.locVecDimension = dimension;
			this.cachedModelKey = currentKey;
			return;
		}

		try {
			await db.execute(
				`CREATE VIRTUAL TABLE vec_locations USING vec0(story_id TEXT PARTITION KEY, embedding float[${dimension}])`
			);
		} catch (err) {
			if (err instanceof Error && err.message.includes('no such module: vec0')) {
				await db.execute(`
					CREATE TABLE vec_locations (
						rowid INTEGER PRIMARY KEY AUTOINCREMENT,
						story_id TEXT NOT NULL,
						embedding TEXT NOT NULL
					)
				`);
			} else {
				throw err;
			}
		}

		await db.execute(
			"INSERT INTO memory_config (key, value) VALUES ('loc_vec_dimension', $1) ON CONFLICT(key) DO UPDATE SET value = $1",
			[String(dimension)]
		);
		await db.execute(
			"INSERT INTO memory_config (key, value) VALUES ('loc_model_key', $1) ON CONFLICT(key) DO UPDATE SET value = $1",
			[currentKey]
		);
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
				'INSERT INTO vec_memories(story_id, act_line_id, embedding) VALUES ($1, $2, $3)',
				[storyId, actLineId, JSON.stringify(embedding)]
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
			'INSERT INTO vec_locations(story_id, embedding) VALUES ($1, $2)',
			[storyId, JSON.stringify(embedding)]
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
				  AND k = $2
				  AND story_id = $3
				ORDER BY distance
			) sub
			JOIN memory_meta m ON m.vec_rowid = sub.rowid
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
		await db.execute(
			"DELETE FROM memory_config WHERE key IN ('vec_dimension', 'model_key', 'loc_vec_dimension', 'loc_model_key')"
		);

		// Reset in-memory cache
		this.vecDimension = null;
		this.locVecDimension = null;
		this.cachedModelKey = null;
	}
}
