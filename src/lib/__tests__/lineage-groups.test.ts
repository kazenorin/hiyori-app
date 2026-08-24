import { describe, expect, it } from 'vitest';
import { computeLineageGroups } from '$lib/db/lineage-groups';
import type { Act } from '$lib/db/acts';
import type { ActLineMeta } from '$lib/db/act-lines';

function makeAct(partial: Partial<Act> & Pick<Act, 'id' | 'actNumber'>): Act {
	return {
		storyId: 's1',
		name: `Act ${partial.actNumber}`,
		continuesFromActLineId: null,
		createdAt: 0,
		updatedAt: 0,
		...partial,
	};
}

function makeLine(partial: Partial<ActLineMeta> & Pick<ActLineMeta, 'id' | 'actId'>): ActLineMeta {
	return { name: partial.id, isMainLine: false, createdAt: 0, plotMode: 'guidance', ...partial };
}

// Reference example: distinct act entities per parent line.
// a1: 01, 01-a (fork) | a2 <- 01: 01-02 | a2b <- 01-a: 01-a-02 | a3 <- 01-02: 01-02-03, 01-02-03-a (fork)
const exampleActs = [
	makeAct({ id: 'a1', actNumber: 1 }),
	makeAct({ id: 'a2', actNumber: 2, continuesFromActLineId: '01' }),
	makeAct({ id: 'a2b', actNumber: 2, continuesFromActLineId: '01-a' }),
	makeAct({ id: 'a3', actNumber: 3, continuesFromActLineId: '01-02' }),
];
const exampleLines = [
	makeLine({ id: '01', actId: 'a1', createdAt: 1 }),
	makeLine({ id: '01-a', actId: 'a1', createdAt: 2 }),
	makeLine({ id: '01-02', actId: 'a2', createdAt: 3 }),
	makeLine({ id: '01-a-02', actId: 'a2b', createdAt: 4 }),
	makeLine({ id: '01-02-03', actId: 'a3', createdAt: 5 }),
	makeLine({ id: '01-02-03-a', actId: 'a3', createdAt: 6 }),
];

describe('computeLineageGroups', () => {
	it('creates one group per leaf with the path to root', () => {
		const { groups } = computeLineageGroups(exampleActs, exampleLines);
		const paths = groups.map((g) => g.items.map((i) => i.lineId));
		expect(paths).toEqual([
			['01-02-03', '01-02', '01'],
			['01-02-03-a', '01-02', '01'],
			['01-a-02', '01-a'],
		]);
	});

	it('labels groups by their leaf', () => {
		const { groups } = computeLineageGroups(exampleActs, exampleLines);
		expect(groups[0]).toMatchObject({ leafId: '01-02-03', leafActNumber: 3, leafName: '01-02-03' });
		expect(groups[2]).toMatchObject({ leafId: '01-a-02', leafActNumber: 2 });
	});

	it('orders groups by leaf actNumber desc, then leaf createdAt asc', () => {
		const { groups } = computeLineageGroups(exampleActs, exampleLines);
		expect(groups.map((g) => g.leafId)).toEqual(['01-02-03', '01-02-03-a', '01-a-02']);
	});

	it('forks continue through their act parent; fork in act 1 ends the chain', () => {
		const acts = [makeAct({ id: 'a1', actNumber: 1 })];
		const lines = [makeLine({ id: '01', actId: 'a1', createdAt: 1 }), makeLine({ id: '01-a', actId: 'a1', createdAt: 2 })];
		const { groups, toggleVisible } = computeLineageGroups(acts, lines);
		expect(groups).toHaveLength(2);
		expect(groups.every((g) => g.items.length === 1)).toBe(true);
		// Two leaves but no lineage spans 2 acts → toggle hidden.
		expect(toggleVisible).toBe(false);
	});

	it('hides the toggle for a single lineage', () => {
		const acts = [makeAct({ id: 'a1', actNumber: 1 }), makeAct({ id: 'a2', actNumber: 2, continuesFromActLineId: '01' })];
		const lines = [makeLine({ id: '01', actId: 'a1' }), makeLine({ id: '01-02', actId: 'a2' })];
		const { groups, toggleVisible } = computeLineageGroups(acts, lines);
		expect(groups).toHaveLength(1);
		expect(toggleVisible).toBe(false);
	});

	it('shows the toggle with >=2 leaves and a multi-act lineage', () => {
		const { toggleVisible } = computeLineageGroups(exampleActs, exampleLines);
		expect(toggleVisible).toBe(true);
	});
});
