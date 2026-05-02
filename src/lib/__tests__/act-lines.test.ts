import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mock state
let mockDbSelectResults: unknown[] = [];
const mockDb = {
	execute: vi.fn(async () => ({ rows: [] })),
	select: vi.fn(async (_query: string, _params?: unknown[]) => {
		if (mockDbSelectResults.length > 0) {
			return mockDbSelectResults.shift();
		}
		return [];
	}),
};

vi.mock('$lib/db/database', () => ({
	getDatabase: () => mockDb,
}));

describe('act-lines helpers', () => {
	let getActNumberForActLine: typeof import('$lib/db/act-lines').getActNumberForActLine;
	let getStoryForActLine: typeof import('$lib/db/act-lines').getStoryForActLine;
	let batchResolveActLineInfo: typeof import('$lib/db/act-lines').batchResolveActLineInfo;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockDbSelectResults = [];

		// Re-import to get fresh module bound to our mock
		vi.resetModules();
		vi.doMock('$lib/db/database', () => ({ getDatabase: () => mockDb }));

		const mod = await import('$lib/db/act-lines');
		getActNumberForActLine = mod.getActNumberForActLine;
		getStoryForActLine = mod.getStoryForActLine;
		batchResolveActLineInfo = mod.batchResolveActLineInfo;
	});

	describe('getActNumberForActLine', () => {
		it('returns act number when act line exists', async () => {
			mockDbSelectResults = [[{ act_number: 3 }]];
			const result = await getActNumberForActLine('line-1');
			expect(result).toBe(3);
		});

		it('returns null when act line not found', async () => {
			mockDbSelectResults = [[]];
			const result = await getActNumberForActLine('nonexistent');
			expect(result).toBeNull();
		});
	});

	describe('getStoryForActLine', () => {
		it('returns Story when act line exists', async () => {
			mockDbSelectResults = [[{ id: 'story-42', name: 'My Story', created_at: 1000, updated_at: 2000 }]];
			const result = await getStoryForActLine('line-1');
			expect(result).toEqual({ id: 'story-42', name: 'My Story', createdAt: 1000, updatedAt: 2000 });
		});

		it('throws when act line not found', async () => {
			mockDbSelectResults = [[]];
			await expect(getStoryForActLine('nonexistent')).rejects.toThrow('Orphaned Act Line with no Story');
		});
	});

	describe('batchResolveActLineInfo', () => {
		it('returns empty map for empty input', async () => {
			const result = await batchResolveActLineInfo({});
			expect(result.size).toBe(0);
		});

		it('batch-resolves act numbers, max sequences, and message sequences', async () => {
			// First select: act line info (LEFT JOIN returns max_sequence from subquery)
			mockDbSelectResults.push([{ act_line_id: 'line-1', act_number: 2, max_sequence: 10 }]);
			// Second select: message sequences for line-1
			mockDbSelectResults.push([{ message_id: 'msg-5', sequence: 5 }]);

			const result = await batchResolveActLineInfo({ 'line-1': ['msg-5'] });

			const info = result.get('line-1');
			expect(info).toBeDefined();
			expect(info!.actNumber).toBe(2);
			expect(info!.maxSeq).toBe(10);
			expect(info!.messages.get('msg-5')).toBe(5);
		});

		it('returns null message sequence for unknown message', async () => {
			mockDbSelectResults.push([{ act_line_id: 'line-1', act_number: 1, max_sequence: 5 }]);
			mockDbSelectResults.push([]); // no message sequence found

			const result = await batchResolveActLineInfo({ 'line-1': ['unknown-msg'] });

			const info = result.get('line-1');
			expect(info?.messages.get('unknown-msg')).toBeNull();
		});

		it('resolves multiple messages on same act line with single act-info query', async () => {
			mockDbSelectResults.push([{ act_line_id: 'line-1', act_number: 1, max_sequence: 8 }]);
			mockDbSelectResults.push([
				{ message_id: 'msg-1', sequence: 1 },
				{ message_id: 'msg-2', sequence: 2 },
			]);

			const result = await batchResolveActLineInfo({ 'line-1': ['msg-1', 'msg-2'] });

			// Only 2 DB calls total: 1 for act line info, 1 for message sequences
			expect(mockDb.select).toHaveBeenCalledTimes(2);
			expect(result.get('line-1')?.actNumber).toBe(1);
			expect(result.get('line-1')?.messages.get('msg-1')).toBe(1);
			expect(result.get('line-1')?.messages.get('msg-2')).toBe(2);
		});
	});
});
