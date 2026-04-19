import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderConfig } from '$lib/stores/settings.svelte';

// Mock the database module
let mockDbExecuteCalls: Array<[string, unknown[]]> = [];
let mockDbSelectCalls: Array<[string, unknown[]]> = [];
let mockDbSelectResults: unknown[] = [];

const mockDb = {
	execute: vi.fn(async (query: string, params?: unknown[]) => {
		mockDbExecuteCalls.push([query, params ?? []]);
		return { rows: [] };
	}),
	select: vi.fn(async (query: string, params?: unknown[]) => {
		mockDbSelectCalls.push([query, params ?? []]);
		// Return pre-configured result if available
		if (mockDbSelectResults.length > 0) {
			return mockDbSelectResults.shift();
		}
		return [];
	}),
};

vi.mock('$lib/db/memory-database', () => ({
	getMemoryDatabase: () => mockDb,
}));

// Mock the AI SDK embed/embedMany
const mockEmbedding = [0.1, 0.2, 0.3, 0.4]; // dimension 4

vi.mock('ai', () => ({
	embed: vi.fn(async () => ({ embedding: mockEmbedding })),
	embedMany: vi.fn(async () => ({ embeddings: [mockEmbedding, mockEmbedding] })),
}));

// Mock provider
vi.mock('$lib/ai/provider', () => ({
	createEmbeddingModel: vi.fn(() => ({})),
}));

// Mock crypto.randomUUID
let uuidCounter = 0;
vi.stubGlobal('crypto', {
	randomUUID: () => `test-uuid-${++uuidCounter}`,
});

const testConfig: ProviderConfig = {
	id: 'test-provider-id',
	name: 'Test Provider',
	provider: 'openai',
	apiType: 'responses',
	baseURL: 'https://api.openai.com/v1',
	model: 'text-embedding-3-small',
	apiKey: 'sk-test-key',
};

const MODEL_KEY = 'openai-text-embedding-3-small-https://api.openai.com/v1';

function setupMocksForNewTable() {
	// sqlite_master check (table doesn't exist)
	mockDbSelectResults = [[]];
	// last_insert_rowid after vec insert
	mockDbSelectResults.push([{ rowid: 1 }]);
}

function setupMocksForExistingTable(dimension: number, modelKey: string) {
	// sqlite_master check (table exists)
	mockDbSelectResults = [[{ name: 'vec_memories' }]];
	// memory_config query
	mockDbSelectResults.push([
		{ key: 'vec_dimension', value: String(dimension) },
		{ key: 'model_key', value: modelKey },
	]);
}

function setupMocksForVecInsertRowid(rowid: number) {
	mockDbSelectResults.push([{ rowid }]);
}

describe('Memory', () => {
	let Memory: typeof import('$lib/memory/memory').Memory;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockDbExecuteCalls = [];
		mockDbSelectCalls = [];
		mockDbSelectResults = [];
		uuidCounter = 0;

		// Re-import to get fresh module state
		vi.resetModules();

		// Re-mock after resetModules
		vi.doMock('$lib/db/memory-database', () => ({
			getMemoryDatabase: () => mockDb,
		}));
		vi.doMock('ai', () => ({
			embed: vi.fn(async () => ({ embedding: mockEmbedding })),
			embedMany: vi.fn(async () => ({
				embeddings: [
					[1, 0, 0, 0],
					[0, 1, 0, 0],
				],
			})),
		}));
		vi.doMock('$lib/ai/provider', () => ({
			createEmbeddingModel: vi.fn(() => ({})),
		}));
		vi.stubGlobal('crypto', {
			randomUUID: () => `test-uuid-${++uuidCounter}`,
		});

		const mod = await import('$lib/memory/memory');
		Memory = mod.Memory;
	});

	describe('add', () => {
		it('does nothing when memories array is empty', async () => {
			const memory = new Memory(testConfig);
			await memory.add('story-1', 'line-1', 'msg-1', 'elena', 'tavern', []);

			expect(mockDbExecuteCalls.length).toBe(0);
		});

		it('creates vec table with partition keys and inserts memory', async () => {
			setupMocksForNewTable();
			setupMocksForVecInsertRowid(1);

			const memory = new Memory(testConfig);
			await memory.add('story-1', 'line-1', 'msg-1', 'elena', 'tavern', ['Elena drew her sword.']);

			// Find the vec table creation call
			const createCall = mockDbExecuteCalls.find(([q]) => q.includes('CREATE VIRTUAL TABLE vec_memories'));
			expect(createCall).toBeDefined();
			expect(createCall![0]).toContain('story_id TEXT PARTITION KEY');
			expect(createCall![0]).toContain('act_line_id TEXT PARTITION KEY');

			// Find the vec_memories insert
			const vecInsert = mockDbExecuteCalls.find(([q]) => q.includes('INSERT INTO vec_memories'));
			expect(vecInsert).toBeDefined();
			expect(vecInsert![1]).toContain('story-1');
			expect(vecInsert![1]).toContain('line-1');

			// Find the memory_meta insert
			const metaInsert = mockDbExecuteCalls.find(([q]) => q.includes('INSERT INTO memory_meta'));
			expect(metaInsert).toBeDefined();
			expect(metaInsert![1]).toContain('test-uuid-1');
			expect(metaInsert![1]).toContain('Elena drew her sword.');
		});

		it('inserts multiple memories using embedMany', async () => {
			const { embedMany } = await import('ai');

			setupMocksForExistingTable(4, MODEL_KEY);
			// Two rowid calls for two memories
			setupMocksForVecInsertRowid(1);
			setupMocksForVecInsertRowid(2);

			const memory = new Memory(testConfig);
			const added = await memory.add('story-1', 'line-1', 'msg-1', 'elena', 'tavern', ['Memory 1', 'Memory 2']);

			// Should use embedMany for batch
			expect(vi.mocked(embedMany)).toHaveBeenCalled();
			expect(mockDbExecuteCalls.filter(([q]) => q.includes('INSERT INTO memory_meta')).length).toBe(2);
			expect(added).toBe(2);
		});
	});

	describe('addLocation', () => {
		it('creates vec_locations table and inserts location', async () => {
			// Set up mock select results in call order:
			// 1. isLocationExactMatch → no match
			// 2. sqlite_master check → table doesn't exist
			// 3. isLocationDuplicate → no similar locations
			// 4. last_insert_rowid after vec insert
			mockDbSelectResults = [[{ count: 0 }], [], [{ rowid: 1 }], [{ rowid: 42 }]];

			const memory = new Memory(testConfig);
			await memory.addLocation('story-1', 'line-1', 'msg-1', 'The Ancient Ruins');

			// Find vec_locations creation
			const createCall = mockDbExecuteCalls.find(([q]) => q.includes('CREATE VIRTUAL TABLE vec_locations'));
			expect(createCall).toBeDefined();
			expect(createCall![0]).toContain('story_id TEXT PARTITION KEY');

			// Find vec_locations insert
			const vecInsert = mockDbExecuteCalls.find(([q]) => q.includes('INSERT INTO vec_locations'));
			expect(vecInsert).toBeDefined();
			expect(vecInsert![1]).toContain('story-1');

			// Find location_meta insert
			const metaInsert = mockDbExecuteCalls.find(([q]) => q.includes('INSERT INTO location_meta'));
			expect(metaInsert).toBeDefined();
		});

		it('skips similar location with cosine distance < 0.1', async () => {
			// First call: insert succeeds. Second call: rejected by similarity.
			mockDbSelectResults = [
				// First addLocation
				[{ count: 0 }], // isLocationExactMatch
				[], // sqlite_master (no table)
				[], // isLocationDuplicate (empty)
				[{ rowid: 42 }], // last_insert_rowid
				// Second addLocation (different text, same embedding)
				[{ count: 0 }], // isLocationExactMatch (different text)
				[{ name: 'vec_locations' }], // sqlite_master (exists)
				[
					{ key: 'loc_vec_dimension', value: '4' },
					{ key: 'loc_model_key', value: MODEL_KEY },
				], // memory_config
				[{ distance: 0.05 }], // isLocationDuplicate (similar found)
			];

			const memory = new Memory(testConfig);
			const first = await memory.addLocation('story-1', 'line-1', 'msg-1', 'The Ancient Ruins');
			expect(first).toBe(true);

			// Clear execute calls to count inserts on second call
			mockDbExecuteCalls = [];

			const second = await memory.addLocation('story-1', 'line-1', 'msg-2', 'The Old Ruins');
			expect(second).toBe(false);

			// No new inserts should have happened
			expect(mockDbExecuteCalls.some(([q]) => q.includes('INSERT INTO vec_locations'))).toBe(false);
			expect(mockDbExecuteCalls.some(([q]) => q.includes('INSERT INTO location_meta'))).toBe(false);
		});
	});

	describe('search', () => {
		it('queries with partition key constraint', async () => {
			setupMocksForExistingTable(4, MODEL_KEY);
			// KNN result
			mockDbSelectResults.push([
				{
					id: 'mem-1',
					content: 'Elena fought the dragon.',
					story_id: 'story-1',
					act_line_id: 'line-1',
					character_canonical_name: 'elena',
					location: 'cave',
					created_at: '2026-01-01',
					distance: 0.15,
				},
			]);

			const memory = new Memory(testConfig);
			const results = await memory.search('dragon fight', { storyId: 'story-1' });

			// Find the KNN search call (not the sqlite_master or memory_config calls)
			const searchCall = mockDbSelectCalls.find(([q]) => q.includes('WHERE embedding MATCH'));
			expect(searchCall).toBeDefined();
			expect(searchCall![0]).toContain('story_id = ?');
			expect(searchCall![1]).toContain('story-1');

			expect(results.length).toBe(1);
			expect(results[0].memory).toBe('Elena fought the dragon.');
			expect(results[0].storyId).toBe('story-1');
		});

		it('uses default limit of 5', async () => {
			setupMocksForExistingTable(4, MODEL_KEY);
			mockDbSelectResults.push([]);

			const memory = new Memory(testConfig);
			await memory.search('test', { storyId: 'story-1' });

			const knnCall = mockDbSelectCalls.find(([q]) => q.includes('k = ?'));
			expect(knnCall).toBeDefined();
			expect(knnCall![1][1]).toBe(5);
		});
	});

	describe('delete', () => {
		it('deletes vector and metadata row', async () => {
			mockDbSelectResults.push([{ rowid: 7 }]);

			const memory = new Memory(testConfig);
			await memory.delete('mem-1');

			const vecDelete = mockDbExecuteCalls.find(([q]) => q.includes('DELETE FROM vec_memories'));
			expect(vecDelete).toBeDefined();

			const metaDelete = mockDbExecuteCalls.find(([q]) => q.includes('DELETE FROM memory_meta WHERE id'));
			expect(metaDelete).toBeDefined();
			expect(metaDelete![1]).toContain('mem-1');
		});

		it('handles missing vector row gracefully', async () => {
			mockDbSelectResults.push([]); // no vec_rowid found

			const memory = new Memory(testConfig);
			await memory.delete('mem-1');

			// Should still delete from memory_meta
			const metaDelete = mockDbExecuteCalls.find(([q]) => q.includes('DELETE FROM memory_meta'));
			expect(metaDelete).toBeDefined();
		});
	});

	describe('reset', () => {
		it('clears all data tables and config', async () => {
			const memory = new Memory(testConfig);
			await memory.reset();

			expect(mockDbExecuteCalls.some(([q]) => q === 'DELETE FROM vec_memories')).toBe(true);
			expect(mockDbExecuteCalls.some(([q]) => q === 'DELETE FROM memory_meta')).toBe(true);
			expect(mockDbExecuteCalls.some(([q]) => q === 'DELETE FROM vec_locations')).toBe(true);
			expect(mockDbExecuteCalls.some(([q]) => q === 'DELETE FROM location_meta')).toBe(true);
			expect(mockDbExecuteCalls.some(([q]) => q.includes('DELETE FROM memory_config WHERE key IN'))).toBe(true);
		});
	});

	describe('dimension mismatch detection', () => {
		it('throws on dimension mismatch with existing table', async () => {
			setupMocksForExistingTable(1536, MODEL_KEY); // Wrong dimension (1536 vs 4)

			const memory = new Memory(testConfig);
			await expect(memory.add('story-1', 'line-1', 'msg-1', 'elena', 'tavern', ['A memory.'])).rejects.toThrow(
				'Embedding dimension mismatch'
			);
		});

		it('throws on model key mismatch with existing table', async () => {
			setupMocksForExistingTable(4, 'different-model-key');

			const memory = new Memory(testConfig);
			await expect(memory.add('story-1', 'line-1', 'msg-1', 'elena', 'tavern', ['A memory.'])).rejects.toThrow('Embedding model changed');
		});
	});

	describe('ensureVecTable caching', () => {
		it('skips table check on second call when dimension matches', async () => {
			setupMocksForExistingTable(4, MODEL_KEY);
			setupMocksForVecInsertRowid(1);

			const memory = new Memory(testConfig);

			// First add
			await memory.add('story-1', 'line-1', 'msg-1', 'elena', 'tavern', ['Memory 1']);
			const sqliteMasterCallsFirst = mockDbSelectCalls.filter(([q]) => q.includes('sqlite_master')).length;

			// Second add — should skip sqlite_master check due to cache
			setupMocksForVecInsertRowid(2);
			await memory.add('story-1', 'line-1', 'msg-1', 'elena', 'forest', ['Memory 2']);

			const sqliteMasterCallsTotal = mockDbSelectCalls.filter(([q]) => q.includes('sqlite_master')).length;
			expect(sqliteMasterCallsTotal).toBe(sqliteMasterCallsFirst); // No additional calls
		});
	});

	describe('knownCharacterNameList', () => {
		it('returns distinct character names with hyphens replaced', async () => {
			mockDbSelectResults.push([
				{ character_canonical_name: 'elena-thornwood' },
				{ character_canonical_name: 'marcus-vale' },
				{ character_canonical_name: 'elena-thornwood' }, // duplicate
			]);

			const mod = await import('$lib/memory/memory');
			const names = await mod.knownCharacterNameList();

			// SELECT DISTINCT should be in the query
			const selectCall = mockDbSelectCalls.find(([q]) => q.includes('DISTINCT character_canonical_name'));
			expect(selectCall).toBeDefined();
			expect(names).toEqual(['elena thornwood', 'marcus vale', 'elena thornwood']);
		});

		it('returns empty array on error', async () => {
			mockDb.select.mockRejectedValueOnce(new Error('table not found'));

			const mod = await import('$lib/memory/memory');
			const names = await mod.knownCharacterNameList();

			expect(names).toEqual([]);
		});
	});
});
