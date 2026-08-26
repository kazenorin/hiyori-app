import type { Act } from '$lib/db/acts';
import type { ActLineMeta } from '$lib/db/act-lines';
import type { LineageGroupsResult } from '$lib/db/lineage-groups';

export interface CollapsedLine {
	lineId: string;
	label: string;
}

export interface CollapsedGroup {
	id: string;
	label: string;
	/** Lineage act count; only set when grouped by act line. */
	badge?: number;
	lines: CollapsedLine[];
}

function firstChar(name: string): string {
	return [...name.trim()][0] ?? '?';
}

/**
 * Derives collapsed-sidebar icon contents for one story.
 * Off mode (grouped by Acts): groups = acts labeled with the act number,
 * lines labeled with the line name's first character.
 * On mode (lineages): groups = leaf lineages labeled with the latest line's
 * first character plus a badge with the distinct act count, lines labeled
 * with their act numbers.
 */
export function deriveCollapsedGroups(args: {
	acts: Act[];
	lines: ActLineMeta[];
	lineage: LineageGroupsResult | undefined;
	groupByLine: boolean;
}): CollapsedGroup[] {
	const { acts, lines, lineage, groupByLine } = args;
	if (groupByLine && lineage) {
		return lineage.groups.map((g) => ({
			id: g.leafId,
			label: firstChar(g.items[0]?.name ?? g.leafName),
			badge: new Set(g.items.map((i) => i.actId)).size,
			lines: g.items.map((i) => ({ lineId: i.lineId, label: String(i.actNumber) })),
		}));
	}
	const sortedActs = [...acts].sort((a, b) => a.actNumber - b.actNumber);
	return sortedActs.map((act) => ({
		id: act.id,
		label: String(act.actNumber),
		lines: lines.filter((l) => l.actId === act.id).map((l) => ({ lineId: l.id, label: firstChar(l.name) })),
	}));
}
