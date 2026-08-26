import { describe, it, expect } from 'vitest';
import { deriveCollapsedGroups } from '$lib/components/chat/collapsed-icons';
import type { Act } from '$lib/db/acts';
import type { ActLineMeta } from '$lib/db/act-lines';
import type { LineageGroupsResult } from '$lib/db/lineage-groups';

function act(id: string, actNumber: number, continuesFromActLineId: string | null = null): Act {
	return { id, actNumber, continuesFromActLineId } as Act;
}

function line(id: string, actId: string, name: string): ActLineMeta {
	return { id, actId, name, createdAt: 0 } as ActLineMeta;
}

describe('deriveCollapsedGroups', () => {
	const acts = [act('a2', 2, 'l1'), act('a1', 1)];
	const lines = [line('l1', 'a1', 'Main Line'), line('l2', 'a2', 'Branch')];

	it('off mode: groups are acts sorted by number, labeled with act number; lines labeled with first letter', () => {
		const result = deriveCollapsedGroups({ acts, lines, lineage: undefined, groupByLine: false });
		expect(result.map((g) => g.label)).toEqual(['1', '2']);
		expect(result[0].id).toBe('a1');
		expect(result[0].lines).toEqual([{ lineId: 'l1', label: 'M' }]);
		expect(result[1].lines).toEqual([{ lineId: 'l2', label: 'B' }]);
	});

	it('on mode: groups are lineages labeled with the latest line first char plus act-count badge', () => {
		const lineage: LineageGroupsResult = {
			toggleVisible: true,
			groups: [
				{
					leafId: 'l2',
					leafActId: 'a2',
					leafActNumber: 2,
					leafName: 'Branch',
					leafCreatedAt: 0,
					items: [
						{ lineId: 'l2', actId: 'a2', actNumber: 2, name: 'Branch' },
						{ lineId: 'l1', actId: 'a1', actNumber: 1, name: 'Main Line' },
					],
				},
			],
		};
		const result = deriveCollapsedGroups({ acts, lines, lineage, groupByLine: true });
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('l2');
		expect(result[0].label).toBe('B');
		expect(result[0].badge).toBe(2);
		expect(result[0].lines).toEqual([
			{ lineId: 'l2', label: '2' },
			{ lineId: 'l1', label: '1' },
		]);
	});

	it('on mode without lineage falls back to acts grouping', () => {
		const result = deriveCollapsedGroups({ acts, lines, lineage: undefined, groupByLine: true });
		expect(result.map((g) => g.label)).toEqual(['1', '2']);
	});

	it('blank names fall back to "?"', () => {
		const result = deriveCollapsedGroups({
			acts: [act('a1', 1)],
			lines: [line('l1', 'a1', '   ')],
			lineage: undefined,
			groupByLine: false,
		});
		expect(result[0].lines[0].label).toBe('?');
	});

	it('act without lines yields an empty lines array', () => {
		const result = deriveCollapsedGroups({ acts: [act('a1', 1)], lines: [], lineage: undefined, groupByLine: false });
		expect(result[0].lines).toEqual([]);
	});
});
