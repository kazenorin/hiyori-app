import { embed, embedMany } from 'ai';
import Database from '@tauri-apps/plugin-sql';
import { getMemoryDatabase } from '$lib/db/memory-database';
import { createEmbeddingModel } from '$lib/ai/provider';
import type { ProviderConfig } from '$lib/stores/settings.svelte';

function cosineDistance(a: number[], b: number[]): number {
	let dot = 0,
		normA = 0,
		normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface MemorySearchOptions {
	storyId: string;
	actLineId?: string;
	limit?: number;
	locations?: LocationItem[];
}

export interface MemoryItem {
	id: string;
	memory: string;
	score?: number;
	messageId: string;
	storyId: string;
	actLineId: string;
	characterCanonicalName: string;
	location: string;
	createdAt?: string;
}

interface MemoryMetaRow {
	id: string;
	content: string;
	message_id: string;
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
	message_id: string;
	story_id: string;
	act_line_id: string;
	created_at: string;
	distance?: number;
}

interface VecRow {
	rowid: number;
}

export interface LocationItem {
	id: string;
	location: string;
	score?: number;
	messageId: string;
	storyId: string;
	actLineId: string;
	createdAt?: string;
}

export class Memory {
	private readonly embeddingProviderConfig: ProviderConfig;
	private embeddingModel: ReturnType<typeof createEmbeddingModel> | null = null;
	private vecDimension: number | null = null;
	private locVecDimension: number | null = null;
	private cachedModelKey: string | null = null;

	constructor(embeddingProviderConfig: ProviderConfig) {
		this.embeddingProviderConfig = embeddingProviderConfig;
	}

	private getModelCacheKey(): string {
		return `${this.embeddingProviderConfig.provider}-${this.embeddingProviderConfig.model}-${this.embeddingProviderConfig.baseURL}`;
	}

	/**
	 * Verify that the current embedding model produces compatible vectors with a previously-stored model.
	 * 1. Check exact key match
	 * 2. Check recorded compatibility in memory_config
	 * 3. Challenge: sample existing content→vector pairs, regenerate with current model, compare
	 */
	private async verifyModelCompatibility(storedModelKey: string, currentKey: string): Promise<boolean> {
		if (storedModelKey === currentKey) return true;

		const db = getMemoryDatabase();

		// Check if already verified compatible
		const compatKey = `compat:${currentKey}`;
		const rows = await db.select<Array<{ value: string }>>('SELECT value FROM memory_config WHERE key = $1', [compatKey]);
		if (rows.length > 0 && rows[0].value === storedModelKey) {
			return true;
		}

		// Sample content rows for challenge
		const samples = await db.select<Array<{ vec_rowid: number; content: string }>>(
			`SELECT mm.vec_rowid, mm.content
			 FROM memory_meta mm
			 ORDER BY RANDOM()
			 LIMIT 5`
		);

		if (samples.length === 0) {
			// No data to challenge against — cannot verify compatibility
			return false;
		}

		// Generate embeddings with current model
		const contents = samples.map((s) => s.content);
		const newEmbeddings = await this.generateEmbeddings(contents);

		// Use database-level cosine distance to compare each new embedding against stored vector
		for (let i = 0; i < samples.length; i++) {
			const distRows = await db.select<Array<{ distance: number }>>(
				`SELECT vec_distance_cosine($1, embedding) as distance FROM vec_memories WHERE rowid = $2`,
				[JSON.stringify(newEmbeddings[i]), samples[i].vec_rowid]
			);
			if (distRows.length === 0 || distRows[0].distance >= 0.05) {
				return false;
			}
		}

		// All matched — record compatibility
		await db.execute('INSERT INTO memory_config (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2', [
			compatKey,
			storedModelKey,
		]);
		return true;
	}

	private getEmbeddingModel() {
		if (!this.embeddingModel) {
			this.embeddingModel = createEmbeddingModel(this.embeddingProviderConfig);
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

	private deduplicateMemories(
		memories: string[],
		embeddings: number[][]
	): {
		memories: string[];
		embeddings: number[][];
	} {
		if (memories.length <= 1) return { memories: [...memories], embeddings: [...embeddings] };

		const keep = new Set<number>();
		for (let i = 0; i < embeddings.length; i++) {
			let isDuplicate = false;
			for (let j = 0; j < i; j++) {
				if (keep.has(j) && cosineDistance(embeddings[i], embeddings[j]) < 0.1) {
					isDuplicate = true;
					break;
				}
			}
			if (!isDuplicate) keep.add(i);
		}

		return {
			memories: memories.filter((_, i) => keep.has(i)),
			embeddings: embeddings.filter((_, i) => keep.has(i)),
		};
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
			const storedDimension = allConfig.find((c) => c.key === 'vec_dimension')?.value;
			const storedModelKey = allConfig.find((c) => c.key === 'model_key')?.value;

			if (storedDimension && parseInt(storedDimension, 10) !== dimension) {
				throw new Error(
					`Embedding dimension mismatch: existing table uses ${storedDimension}, but current model produces ${dimension}. Reset memory to switch embedding models.`
				);
			}
			if (storedModelKey && storedModelKey !== currentKey) {
				if (!(await this.verifyModelCompatibility(storedModelKey, currentKey))) {
					throw new Error(
						`Embedding model "${currentKey}" is incompatible with stored model "${storedModelKey}". Reset memory to switch embedding models.`
					);
				}
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

		await db.execute("INSERT INTO memory_config (key, value) VALUES ('vec_dimension', $1) ON CONFLICT(key) DO UPDATE SET value = $1", [
			String(dimension),
		]);
		await db.execute("INSERT INTO memory_config (key, value) VALUES ('model_key', $1) ON CONFLICT(key) DO UPDATE SET value = $1", [
			currentKey,
		]);
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
			const storedDimension = allConfig.find((c) => c.key === 'loc_vec_dimension')?.value;
			const storedModelKey = allConfig.find((c) => c.key === 'loc_model_key')?.value;

			if (storedDimension && parseInt(storedDimension, 10) !== dimension) {
				throw new Error(
					`Location embedding dimension mismatch: existing table uses ${storedDimension}, but current model produces ${dimension}. Reset memory to switch embedding models.`
				);
			}
			if (storedModelKey && storedModelKey !== currentKey) {
				if (!(await this.verifyModelCompatibility(storedModelKey, currentKey))) {
					throw new Error(
						`Location embedding model "${currentKey}" is incompatible with stored model "${storedModelKey}". Reset memory to switch embedding models.`
					);
				}
			}

			this.locVecDimension = dimension;
			this.cachedModelKey = currentKey;
			return;
		}

		try {
			await db.execute(`CREATE VIRTUAL TABLE vec_locations USING vec0(story_id TEXT PARTITION KEY, embedding float[${dimension}])`);
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

		await db.execute("INSERT INTO memory_config (key, value) VALUES ('loc_vec_dimension', $1) ON CONFLICT(key) DO UPDATE SET value = $1", [
			String(dimension),
		]);
		await db.execute("INSERT INTO memory_config (key, value) VALUES ('loc_model_key', $1) ON CONFLICT(key) DO UPDATE SET value = $1", [
			currentKey,
		]);
		this.locVecDimension = dimension;
	}

	async add(
		storyId: string,
		actLineId: string,
		messageId: string,
		characterCanonicalName: string,
		location: string,
		memories: string[]
	): Promise<number> {
		if (memories.length === 0) return 0;

		const embeddings = memories.length === 1 ? [await this.generateEmbedding(memories[0])] : await this.generateEmbeddings(memories);

		// Deduplicate: keep earlier memory when cosine distance < 0.1
		const { memories: dedupedMemories, embeddings: dedupedEmbeddings } = this.deduplicateMemories(memories, embeddings);

		if (dedupedMemories.length === 0) return 0;

		const db = getMemoryDatabase();
		const dimension = dedupedEmbeddings[0].length;
		await this.ensureMemoryVecTable(dimension);

		// Batch insert deduplicated memories
		await this.insertMemoryBatch(db, storyId, actLineId, messageId, characterCanonicalName, location, dedupedMemories, dedupedEmbeddings);
		return dedupedMemories.length;
	}

	private async insertMemoryBatch(
		db: Database,
		storyId: string,
		actLineId: string,
		messageId: string,
		characterCanonicalName: string,
		location: string,
		memories: string[],
		embeddings: number[][]
	): Promise<void> {
		// Insert all vectors first
		const vecRowids: number[] = [];
		for (const embedding of embeddings) {
			await db.execute('INSERT INTO vec_memories(story_id, act_line_id, embedding) VALUES ($1, $2, $3)', [
				storyId,
				actLineId,
				JSON.stringify(embedding),
			]);

			const rowResult = await db.select<VecRow[]>('SELECT last_insert_rowid() as rowid');
			const vecRowid = rowResult[0]?.rowid;

			if (!vecRowid) {
				throw new Error('Failed to retrieve vector rowid after insert');
			}
			vecRowids.push(vecRowid);
		}

		// Insert all metadata
		for (let i = 0; i < memories.length; i++) {
			const id = crypto.randomUUID();
			const text = memories[i];

			await db.execute(
				`INSERT INTO memory_meta (
					id, vec_rowid, content, message_id, story_id, act_line_id, character_canonical_name, location
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
				[id, vecRowids[i], text, messageId, storyId, actLineId, characterCanonicalName, location]
			);
		}
	}

	async addLocation(storyId: string, actLineId: string, messageId: string, location: string): Promise<boolean> {
		// Check for exact text match before generating embedding
		if (await this.isLocationExactMatch(location, storyId, actLineId)) {
			return false;
		}

		const embedding = await this.generateEmbedding(location);
		const dimension = embedding.length;
		await this.ensureLocationVecTable(dimension);

		// Check for similar location in same act line
		if (await this.isLocationDuplicate(embedding, storyId, actLineId)) {
			return false;
		}

		const db = getMemoryDatabase();
		const id = crypto.randomUUID();

		await db.execute('INSERT INTO vec_locations(story_id, embedding) VALUES ($1, $2)', [storyId, JSON.stringify(embedding)]);

		const rowResult = await db.select<VecRow[]>('SELECT last_insert_rowid() as rowid');
		const vecRowid = rowResult[0]?.rowid;

		if (!vecRowid) {
			throw new Error('Failed to retrieve location vector rowid after insert');
		}

		await db.execute(
			`INSERT INTO location_meta (id, vec_rowid, location_text, message_id, story_id, act_line_id)
			VALUES ($1, $2, $3, $4, $5, $6)`,
			[id, vecRowid, location, messageId, storyId, actLineId]
		);
		return true;
	}

	private async isLocationExactMatch(location: string, storyId: string, actLineId: string): Promise<boolean> {
		const db = getMemoryDatabase();
		try {
			const rows = await db.select<Array<{ count: number }>>(
				'SELECT COUNT(*) as count FROM location_meta WHERE location_text = $1 AND story_id = $2 AND act_line_id = $3',
				[location, storyId, actLineId]
			);
			return rows.length > 0 && rows[0].count > 0;
		} catch {
			return false;
		}
	}

	private async isLocationDuplicate(embedding: number[], storyId: string, actLineId: string): Promise<boolean> {
		const db = getMemoryDatabase();

		try {
			const rows = await db.select<Array<{ distance: number }>>(
				`
				SELECT sub.distance
				FROM (
					SELECT rowid, distance
					FROM vec_locations
					WHERE embedding MATCH $1
					  AND k = 1
					  AND story_id = $2
					ORDER BY distance
					LIMIT 1
				) sub
				JOIN location_meta l ON l.vec_rowid = sub.rowid
				WHERE l.act_line_id = $3
			`,
				[JSON.stringify(embedding), storyId, actLineId]
			);

			return rows.length > 0 && rows[0].distance < 0.1;
		} catch {
			// Table may not exist yet on first call
			return false;
		}
	}

	async search(query: string, options: MemorySearchOptions): Promise<MemoryItem[]> {
		const db = getMemoryDatabase();
		const embedding = await this.generateEmbedding(query);
		const dimension = embedding.length;
		await this.ensureMemoryVecTable(dimension);
		const limit = options.limit ?? 5;

		const hasLocations = options.locations && options.locations.length > 0;
		const locationPlaceholders = hasLocations ? options.locations!.map(() => '?').join(', ') : null;

		const whereClauses: string[] = ['embedding MATCH ?', 'k = ?', 'story_id = ?'];
		const params: unknown[] = [JSON.stringify(embedding), limit, options.storyId];

		if (options.actLineId) {
			whereClauses.push('act_line_id = ?');
			params.push(options.actLineId);
		}

		const vecSql = `
			SELECT rowid, distance
			FROM vec_memories
			WHERE ${whereClauses.join(' AND ')}
			ORDER BY distance
		`;

		let metaWhere = '1=1';
		const metaParams: unknown[] = [];

		if (hasLocations) {
			metaWhere = `m.location IN (${locationPlaceholders})`;
			metaParams.push(...options.locations!.map((l) => l.location));
		}

		const sql = `
			SELECT m.id, m.content, m.message_id, m.story_id, m.act_line_id, m.character_canonical_name, m.location, m.created_at, sub.distance
			FROM (
				${vecSql}
			) sub
			JOIN memory_meta m ON m.vec_rowid = sub.rowid
			WHERE ${metaWhere}
			ORDER BY sub.distance
		`;

		const rows = await db.select<MemoryMetaRow[]>(sql, [...params, ...metaParams]);

		return rows.map((row) => ({
			id: row.id,
			memory: row.content,
			score: row.distance,
			messageId: row.message_id,
			storyId: row.story_id,
			actLineId: row.act_line_id,
			characterCanonicalName: row.character_canonical_name,
			location: row.location,
			createdAt: row.created_at,
		}));
	}

	async searchByLocation(query: string, location: string, options: MemorySearchOptions): Promise<MemoryItem[]> {
		const locationResults = await this.searchLocations(location, { ...options, limit: 5 });
		return this.search(query, { ...options, locations: locationResults });
	}

	async getAll(options: MemorySearchOptions): Promise<MemoryItem[]> {
		const db = getMemoryDatabase();

		const sql = options.actLineId
			? 'SELECT id, content, message_id, story_id, act_line_id, character_canonical_name, location, created_at FROM memory_meta WHERE story_id = $1 AND act_line_id = $2 ORDER BY created_at DESC'
			: 'SELECT id, content, message_id, story_id, act_line_id, character_canonical_name, location, created_at FROM memory_meta WHERE story_id = $1 ORDER BY created_at DESC';
		const params = options.actLineId ? [options.storyId, options.actLineId] : [options.storyId];

		const rows = await db.select<MemoryMetaRow[]>(sql, params);

		return rows.map((row) => ({
			id: row.id,
			memory: row.content,
			messageId: row.message_id,
			storyId: row.story_id,
			actLineId: row.act_line_id,
			characterCanonicalName: row.character_canonical_name,
			location: row.location,
			createdAt: row.created_at,
		}));
	}

	async sampleByLocation(location: LocationItem, sampleSize: number): Promise<MemoryItem[]> {
		const db = getMemoryDatabase();

		const rows = await db.select<MemoryMetaRow[]>(
			`SELECT id, content, message_id, story_id, act_line_id, character_canonical_name, location, created_at
			 FROM memory_meta
			 WHERE story_id = $1 AND act_line_id = $2 AND location = $3
			 ORDER BY RANDOM()
			 LIMIT $4`,
			[location.storyId, location.actLineId, location.location, sampleSize]
		);

		return rows.map((row) => ({
			id: row.id,
			memory: row.content,
			messageId: row.message_id,
			storyId: row.story_id,
			actLineId: row.act_line_id,
			characterCanonicalName: row.character_canonical_name,
			location: row.location,
			createdAt: row.created_at,
		}));
	}

	async getAllLocations(options: MemorySearchOptions): Promise<LocationItem[]> {
		const db = getMemoryDatabase();

		const sql = options.actLineId
			? 'SELECT id, location_text, message_id, story_id, act_line_id, created_at FROM location_meta WHERE story_id = $1 AND act_line_id = $2 ORDER BY created_at DESC'
			: 'SELECT id, location_text, message_id, story_id, act_line_id, created_at FROM location_meta WHERE story_id = $1 ORDER BY created_at DESC';
		const params = options.actLineId ? [options.storyId, options.actLineId] : [options.storyId];

		const rows = await db.select<LocationMetaRow[]>(sql, params);

		return rows.map((row) => ({
			id: row.id,
			location: row.location_text,
			messageId: row.message_id,
			storyId: row.story_id,
			actLineId: row.act_line_id,
			createdAt: row.created_at,
		}));
	}

	async searchLocations(query: string, options: MemorySearchOptions): Promise<LocationItem[]> {
		const db = getMemoryDatabase();
		const embedding = await this.generateEmbedding(query);
		const dimension = embedding.length;
		await this.ensureLocationVecTable(dimension);
		const limit = options.limit ?? 5;

		const sql = `
			SELECT l.id, l.location_text, l.message_id, l.story_id, l.act_line_id, l.created_at, sub.distance
			FROM (
				SELECT rowid, distance
				FROM vec_locations
				WHERE embedding MATCH $1
				  AND k = $2
				  AND story_id = $3
				ORDER BY distance
			) sub
			JOIN location_meta l ON l.vec_rowid = sub.rowid
			ORDER BY sub.distance
		`;

		const rows = await db.select<LocationMetaRow[]>(sql, [JSON.stringify(embedding), limit, options.storyId]);

		return rows.map((row) => ({
			id: row.id,
			location: row.location_text,
			score: row.distance,
			messageId: row.message_id,
			storyId: row.story_id,
			actLineId: row.act_line_id,
			createdAt: row.created_at,
		}));
	}

	async delete(id: string): Promise<void> {
		const db = getMemoryDatabase();

		const rows = await db.select<VecRow[]>('SELECT vec_rowid as rowid FROM memory_meta WHERE id = $1', [id]);
		const vecRowid = rows[0]?.rowid;

		if (vecRowid) {
			await db.execute('DELETE FROM vec_memories WHERE rowid = $1', [vecRowid]);
		}

		await db.execute('DELETE FROM memory_meta WHERE id = $1', [id]);
	}

	async deleteByActLine(storyId: string, actLineId: string): Promise<number> {
		const db = getMemoryDatabase();

		// Count before deleting
		const countRows = await db.select<Array<{ cnt: number }>>(
			'SELECT COUNT(*) as cnt FROM memory_meta WHERE story_id = $1 AND act_line_id = $2',
			[storyId, actLineId]
		);
		const count = countRows[0]?.cnt ?? 0;

		// Single statement — act_line_id is a partition key on vec_memories
		await db.execute('DELETE FROM vec_memories WHERE story_id = $1 AND act_line_id = $2', [storyId, actLineId]);
		await db.execute('DELETE FROM memory_meta WHERE story_id = $1 AND act_line_id = $2', [storyId, actLineId]);

		return count;
	}

	async deleteLocationsByActLine(storyId: string, actLineId: string): Promise<number> {
		const db = getMemoryDatabase();

		// Get all vec_rowids to delete from vec_locations
		const rows = await db.select<VecRow[]>('SELECT vec_rowid as rowid FROM location_meta WHERE story_id = $1 AND act_line_id = $2', [
			storyId,
			actLineId,
		]);

		// Delete from vec_locations
		for (const row of rows) {
			if (row.rowid) {
				await db.execute('DELETE FROM vec_locations WHERE rowid = $1', [row.rowid]);
			}
		}

		// Delete from location_meta
		await db.execute('DELETE FROM location_meta WHERE story_id = $1 AND act_line_id = $2', [storyId, actLineId]);

		return rows.length;
	}

	async deleteByMessages(storyId: string, actLineId: string, messageIds: string[]): Promise<number> {
		if (messageIds.length === 0) return 0;
		const db = getMemoryDatabase();

		const placeholders = messageIds.map((_, i) => `$${i + 3}`).join(', ');

		// Get vec rowids from meta table (vec_memories has no message_id column)
		const rows = await db.select<VecRow[]>(
			`SELECT vec_rowid as rowid FROM memory_meta WHERE story_id = $1 AND act_line_id = $2 AND message_id IN (${placeholders})`,
			[storyId, actLineId, ...messageIds]
		);

		// Delete from vec_memories by rowid
		for (const row of rows) {
			if (row.rowid) {
				await db.execute('DELETE FROM vec_memories WHERE rowid = $1', [row.rowid]);
			}
		}

		// Delete from memory_meta
		await db.execute(`DELETE FROM memory_meta WHERE story_id = $1 AND act_line_id = $2 AND message_id IN (${placeholders})`, [
			storyId,
			actLineId,
			...messageIds,
		]);

		return rows.length;
	}

	async deleteLocationsByMessages(storyId: string, actLineId: string, messageIds: string[]): Promise<number> {
		if (messageIds.length === 0) return 0;
		const db = getMemoryDatabase();

		const placeholders = messageIds.map((_, i) => `$${i + 3}`).join(', ');

		// Get vec rowids from meta table (vec_locations has no message_id column)
		const rows = await db.select<VecRow[]>(
			`SELECT vec_rowid as rowid FROM location_meta WHERE story_id = $1 AND act_line_id = $2 AND message_id IN (${placeholders})`,
			[storyId, actLineId, ...messageIds]
		);

		// Delete from vec_locations by rowid
		for (const row of rows) {
			if (row.rowid) {
				await db.execute('DELETE FROM vec_locations WHERE rowid = $1', [row.rowid]);
			}
		}

		// Delete from location_meta
		await db.execute(`DELETE FROM location_meta WHERE story_id = $1 AND act_line_id = $2 AND message_id IN (${placeholders})`, [
			storyId,
			actLineId,
			...messageIds,
		]);

		return rows.length;
	}

	async copyMemoriesForFork(
		storyId: string,
		fromLineId: string,
		toLineId: string,
		messageIds: string[]
	): Promise<{ memoriesCopied: number; locationsCopied: number }> {
		if (messageIds.length === 0) return { memoriesCopied: 0, locationsCopied: 0 };
		const db = getMemoryDatabase();
		const msgPlaceholders = messageIds.map((_, i) => `$${i + 3}`).join(', ');

		// --- Copy memories (memory_meta + vec_memories) ---
		interface MemorySourceRow {
			vec_rowid: number;
			content: string;
			message_id: string;
			character_canonical_name: string;
			location: string;
			embeddingJson: string;
		}
		const memRows = await db.select<MemorySourceRow[]>(
			`SELECT mm.vec_rowid, mm.content, mm.message_id, mm.character_canonical_name, mm.location, vec_to_json(vm.embedding) as embeddingJson
			 FROM memory_meta mm
			 JOIN vec_memories vm ON vm.rowid = mm.vec_rowid
			 WHERE mm.story_id = $1 AND mm.act_line_id = $2 AND mm.message_id IN (${msgPlaceholders})`,
			[storyId, fromLineId, ...messageIds]
		);

		for (const row of memRows) {
			await db.execute('INSERT INTO vec_memories(story_id, act_line_id, embedding) VALUES ($1, $2, $3)', [
				storyId,
				toLineId,
				row.embeddingJson,
			]);
			const vecResult = await db.select<VecRow[]>('SELECT last_insert_rowid() as rowid');
			const newVecRowid = vecResult[0]?.rowid;
			if (!newVecRowid) throw new Error('Failed to retrieve vector rowid after insert');

			await db.execute(
				`INSERT INTO memory_meta (id, vec_rowid, content, message_id, story_id, act_line_id, character_canonical_name, location)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
				[crypto.randomUUID(), newVecRowid, row.content, row.message_id, storyId, toLineId, row.character_canonical_name, row.location]
			);
		}

		// --- Copy locations (location_meta + vec_locations) ---
		interface LocationSourceRow {
			vec_rowid: number;
			location_text: string;
			message_id: string;
			embeddingJson: string;
		}
		const locRows = await db.select<LocationSourceRow[]>(
			`SELECT lm.vec_rowid, lm.location_text, lm.message_id, vec_to_json(vl.embedding) as embeddingJson
			 FROM location_meta lm
			 JOIN vec_locations vl ON vl.rowid = lm.vec_rowid
			 WHERE lm.story_id = $1 AND lm.act_line_id = $2 AND lm.message_id IN (${msgPlaceholders})`,
			[storyId, fromLineId, ...messageIds]
		);

		for (const row of locRows) {
			await db.execute('INSERT INTO vec_locations(story_id, embedding) VALUES ($1, $2)', [storyId, row.embeddingJson]);
			const vecResult = await db.select<VecRow[]>('SELECT last_insert_rowid() as rowid');
			const newVecRowid = vecResult[0]?.rowid;
			if (!newVecRowid) throw new Error('Failed to retrieve location vector rowid after insert');

			await db.execute(
				`INSERT INTO location_meta (id, vec_rowid, location_text, message_id, story_id, act_line_id)
				 VALUES ($1, $2, $3, $4, $5, $6)`,
				[crypto.randomUUID(), newVecRowid, row.location_text, row.message_id, storyId, toLineId]
			);
		}

		return { memoriesCopied: memRows.length, locationsCopied: locRows.length };
	}

	async reset(): Promise<void> {
		const db = getMemoryDatabase();
		await db.execute('DELETE FROM vec_memories');
		await db.execute('DELETE FROM memory_meta');
		await db.execute('DELETE FROM vec_locations');
		await db.execute('DELETE FROM location_meta');
		await db.execute("DELETE FROM memory_config WHERE key IN ('vec_dimension', 'model_key', 'loc_vec_dimension', 'loc_model_key')");

		// Reset in-memory cache
		this.vecDimension = null;
		this.locVecDimension = null;
		this.cachedModelKey = null;
	}
}

export async function knownCharacterNameList(): Promise<string[]> {
	const db = getMemoryDatabase();
	try {
		const rows = await db.select<Array<{ character_canonical_name: string }>>('SELECT DISTINCT character_canonical_name FROM memory_meta');
		return rows.map((r) => r.character_canonical_name.replace(/-/g, ' '));
	} catch {
		return [];
	}
}
