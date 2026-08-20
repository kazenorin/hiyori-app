import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Act } from '$lib/db/acts';

// Shared mock state
let mockDbSelectResults: unknown[] = [];
const mockDb = {
	execute: vi.fn(async (_sql: string, _params?: unknown[]) => ({ rowsAffected: 0 })),
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

function makeAct(overrides: Partial<Act> = {}): Act {
	return {
		id: 'act-1',
		storyId: 'story-1',
		name: 'Act 1',
		actNumber: 1,
		continuesFromActLineId: null,
		createdAt: 1000,
		updatedAt: 1000,
		...overrides,
	};
}

describe('canActBeDeleted', () => {
	let canActBeDeleted: typeof import('$lib/db/acts').canActBeDeleted;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockDbSelectResults = [];

		vi.resetModules();
		vi.doMock('$lib/db/database', () => ({ getDatabase: () => mockDb }));

		const mod = await import('$lib/db/acts');
		canActBeDeleted = mod.canActBeDeleted;
	});

	it('returns false when the story has only one act', () => {
		const act = makeAct();
		const lines = [{ id: 'line-1', actId: 'act-1' }];
		expect(canActBeDeleted(act, [act], lines)).toBe(false);
	});

	it('returns true when no other act continues from any of the act lines', () => {
		const act1 = makeAct();
		const act2 = makeAct({ id: 'act-2', actNumber: 2, continuesFromActLineId: 'line-1' });
		const lines = [
			{ id: 'line-1', actId: 'act-1' },
			{ id: 'line-2', actId: 'act-2' },
		];
		expect(canActBeDeleted(act2, [act1, act2], lines)).toBe(true);
	});

	it('returns false when another act continues from a line of the target act', () => {
		const act1 = makeAct();
		const act2 = makeAct({ id: 'act-2', actNumber: 2, continuesFromActLineId: 'line-1' });
		const lines = [
			{ id: 'line-1', actId: 'act-1' },
			{ id: 'line-1b', actId: 'act-1' },
			{ id: 'line-2', actId: 'act-2' },
		];
		expect(canActBeDeleted(act1, [act1, act2], lines)).toBe(false);
	});

	it('returns false when another act continues from a non-main line of the target act', () => {
		const act1 = makeAct();
		const act2 = makeAct({ id: 'act-2', actNumber: 2, continuesFromActLineId: 'line-1b' });
		const lines = [
			{ id: 'line-1', actId: 'act-1' },
			{ id: 'line-1b', actId: 'act-1' },
			{ id: 'line-2', actId: 'act-2' },
		];
		expect(canActBeDeleted(act1, [act1, act2], lines)).toBe(false);
	});

	it('is unaffected by continuation references to lines of unrelated acts', () => {
		const act1 = makeAct();
		const act2 = makeAct({ id: 'act-2', actNumber: 2, continuesFromActLineId: 'line-1' });
		const act3 = makeAct({ id: 'act-3', actNumber: 3, continuesFromActLineId: 'line-2' });
		const lines = [
			{ id: 'line-1', actId: 'act-1' },
			{ id: 'line-2', actId: 'act-2' },
			{ id: 'line-3', actId: 'act-3' },
		];
		expect(canActBeDeleted(act3, [act1, act2, act3], lines)).toBe(true);
	});

	it('ignores acts with null continuesFromActLineId', () => {
		const act1 = makeAct();
		const act2 = makeAct({ id: 'act-2', actNumber: 2, continuesFromActLineId: null });
		const lines = [{ id: 'line-1', actId: 'act-1' }];
		expect(canActBeDeleted(act1, [act1, act2], lines)).toBe(true);
	});
});

describe('canActLineBeDeleted', () => {
	let canActLineBeDeleted: typeof import('$lib/db/acts').canActLineBeDeleted;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockDbSelectResults = [];

		vi.resetModules();
		vi.doMock('$lib/db/database', () => ({ getDatabase: () => mockDb }));

		const mod = await import('$lib/db/acts');
		canActLineBeDeleted = mod.canActLineBeDeleted;
	});

	it('returns true when no act continues from the act line', () => {
		const acts = [makeAct(), makeAct({ id: 'act-2', actNumber: 2, continuesFromActLineId: 'line-1' })];
		expect(canActLineBeDeleted('line-2', acts)).toBe(true);
	});

	it('returns false when another act continues from the act line', () => {
		const acts = [makeAct(), makeAct({ id: 'act-2', actNumber: 2, continuesFromActLineId: 'line-1' })];
		expect(canActLineBeDeleted('line-1', acts)).toBe(false);
	});

	it('returns false when multiple acts continue from the act line', () => {
		const acts = [
			makeAct(),
			makeAct({ id: 'act-2', actNumber: 2, continuesFromActLineId: 'line-1' }),
			makeAct({ id: 'act-3', actNumber: 3, continuesFromActLineId: 'line-1' }),
		];
		expect(canActLineBeDeleted('line-1', acts)).toBe(false);
	});

	it('returns true when all acts have null continuesFromActLineId', () => {
		const acts = [makeAct(), makeAct({ id: 'act-2', actNumber: 2, continuesFromActLineId: null })];
		expect(canActLineBeDeleted('line-1', acts)).toBe(true);
	});
});

describe('getActLinesForStory', () => {
	let getActLinesForStory: typeof import('$lib/db/act-lines').getActLinesForStory;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockDbSelectResults = [];

		vi.resetModules();
		vi.doMock('$lib/db/database', () => ({ getDatabase: () => mockDb }));

		const mod = await import('$lib/db/act-lines');
		getActLinesForStory = mod.getActLinesForStory;
	});

	it('returns all act lines across every act of the story', async () => {
		mockDbSelectResults = [
			[
				{ id: 'line-1', act_id: 'act-1', name: 'Main', is_main_line: 1, created_at: 1000, plot_mode: 'guidance' },
				{ id: 'line-2', act_id: 'act-2', name: 'Branch', is_main_line: 0, created_at: 2000, plot_mode: 'guidance' },
			],
		];
		const result = await getActLinesForStory('story-1');
		expect(result).toEqual([
			{ id: 'line-1', actId: 'act-1', name: 'Main', isMainLine: true, createdAt: 1000, plotMode: 'guidance' },
			{ id: 'line-2', actId: 'act-2', name: 'Branch', isMainLine: false, createdAt: 2000, plotMode: 'guidance' },
		]);
		const [sql, params] = mockDb.select.mock.calls[0];
		expect(sql).toContain('act_line_meta');
		expect(sql).toContain('acts');
		expect(params).toEqual(['story-1']);
	});

	it('returns empty array when the story has no acts', async () => {
		mockDbSelectResults = [[]];
		const result = await getActLinesForStory('story-1');
		expect(result).toEqual([]);
	});
});
