import type { Act } from '$lib/db/acts';
import type { ActLineMeta } from '$lib/db/act-lines';
import type { LineageGroupsResult } from '$lib/db/lineage-groups';

export interface CollapsedLine {
	lineId: string;
	label: string;
	/** Full display text for the collapsed strip's instant tooltip and aria-label. */
	tooltip: string;
}

export interface CollapsedGroup {
	id: string;
	label: string;
	/** Full display text for the collapsed strip's instant tooltip and aria-label. */
	tooltip: string;
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
 * Tooltips carry full names: acts mode → act/line names; lineage mode →
 * latest-line name per group and act names per line.
 */
export function deriveCollapsedGroups(args: {
	acts: Act[];
	lines: ActLineMeta[];
	lineage: LineageGroupsResult | undefined;
	groupByLine: boolean;
}): CollapsedGroup[] {
	const { acts, lines, lineage, groupByLine } = args;
	if (groupByLine && lineage) {
		const actNames = new Map(acts.map((a) => [a.id, a.name]));
		return lineage.groups.map((g) => ({
			id: g.leafId,
			label: firstChar(g.items[0]?.name ?? g.leafName),
			tooltip: g.items[0]?.name ?? g.leafName,
			badge: new Set(g.items.map((i) => i.actId)).size,
			lines: g.items.map((i) => ({
				lineId: i.lineId,
				label: String(i.actNumber),
				tooltip: actNames.get(i.actId) ?? String(i.actNumber),
			})),
		}));
	}
	const sortedActs = [...acts].sort((a, b) => a.actNumber - b.actNumber);
	return sortedActs.map((act) => ({
		id: act.id,
		label: String(act.actNumber),
		tooltip: act.name,
		lines: lines.filter((l) => l.actId === act.id).map((l) => ({ lineId: l.id, label: firstChar(l.name), tooltip: l.name })),
	}));
}
