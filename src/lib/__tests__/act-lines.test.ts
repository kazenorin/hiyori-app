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
	let getStoryIdForActLine: typeof import('$lib/db/act-lines').getStoryIdForActLine;
	let batchResolveActLineInfo: typeof import('$lib/db/act-lines').batchResolveActLineInfo;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockDbSelectResults = [];

		// Re-import to get fresh module bound to our mock
		vi.resetModules();
		vi.doMock('$lib/db/database', () => ({ getDatabase: () => mockDb }));

		const mod = await import('$lib/db/act-lines');
		getActNumberForActLine = mod.getActNumberForActLine;
		getStoryIdForActLine = mod.getStoryIdForActLine;
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

	describe('getStoryIdForActLine', () => {
		it('returns story ID when act line exists', async () => {
			mockDbSelectResults = [[{ story_id: 'story-42' }]];
			const result = await getStoryIdForActLine('line-1');
			expect(result).toBe('story-42');
		});

		it('returns null when act line not found', async () => {
			mockDbSelectResults = [[]];
			const result = await getStoryIdForActLine('nonexistent');
			expect(result).toBeNull();
		});
	});

	describe('batchResolveActLineInfo', () => {
		it('returns empty map for empty input', async () => {
			const result = await batchResolveActLineInfo([]);
			expect(result.size).toBe(0);
		});

		it('batch-resolves act numbers, max sequences, and message sequences', async () => {
			// First select: act line info
			mockDbSelectResults.push([{ id: 'line-1', act_number: 2, max_seq: 10 }]);
			// Second select: message sequences
			mockDbSelectResults.push([{ act_line_id: 'line-1', message_id: 'msg-5', sequence: 5 }]);

			const items = [{ actLineId: 'line-1', messageId: 'msg-5' }];
			const result = await batchResolveActLineInfo(items);

			const info = result.get('line-1:msg-5');
			expect(info).toBeDefined();
			expect(info!.actNumber).toBe(2);
			expect(info!.maxSeq).toBe(10);
			expect(info!.msgSeq).toBe(5);
		});

		it('returns null msgSeq for unknown message', async () => {
			mockDbSelectResults.push([{ id: 'line-1', act_number: 1, max_seq: 5 }]);
			mockDbSelectResults.push([]); // no message sequence found

			const items = [{ actLineId: 'line-1', messageId: 'unknown-msg' }];
			const result = await batchResolveActLineInfo(items);

			const info = result.get('line-1:unknown-msg');
			expect(info?.msgSeq).toBeNull();
		});

		it('deduplicates act line queries for multiple items on same line', async () => {
			mockDbSelectResults.push([{ id: 'line-1', act_number: 1, max_seq: 8 }]);
			mockDbSelectResults.push([
				{ act_line_id: 'line-1', message_id: 'msg-1', sequence: 1 },
				{ act_line_id: 'line-1', message_id: 'msg-2', sequence: 2 },
			]);

			const items = [
				{ actLineId: 'line-1', messageId: 'msg-1' },
				{ actLineId: 'line-1', messageId: 'msg-2' },
			];
			const result = await batchResolveActLineInfo(items);

			// Only 2 DB calls total: 1 for act line info, 1 for message sequences
			expect(mockDb.select).toHaveBeenCalledTimes(2);
			expect(result.get('line-1:msg-1')?.actNumber).toBe(1);
			expect(result.get('line-1:msg-2')?.actNumber).toBe(1);
			expect(result.get('line-1:msg-1')?.msgSeq).toBe(1);
			expect(result.get('line-1:msg-2')?.msgSeq).toBe(2);
		});
	});
});
