import { getActsForStory, type Act } from './acts';
import { getActLinesForStory, type ActLineMeta } from './act-lines';

export interface LineageGroupItem {
	lineId: string;
	actId: string;
	actNumber: number;
	name: string;
}

export interface LineageGroup {
	leafId: string;
	leafActId: string;
	leafActNumber: number;
	leafName: string;
	leafCreatedAt: number;
	/** Lineage path, latest first (leaf → root). */
	items: LineageGroupItem[];
}

export interface LineageGroupsResult {
	groups: LineageGroup[];
	toggleVisible: boolean;
}

/**
 * Groups act lines into leaf-based lineages: one group per leaf (a line no act
 * continues from), items = the path back to the root via each act's
 * `continuesFromActLineId`. Forks have no own parent link and fall through to
 * their act's parent.
 */
export function computeLineageGroups(acts: Act[], lines: ActLineMeta[]): LineageGroupsResult {
	const actById = new Map(acts.map((a) => [a.id, a]));
	const lineById = new Map(lines.map((l) => [l.id, l]));
	const continued = new Set(acts.map((a) => a.continuesFromActLineId).filter((id): id is string => id !== null));
	const leaves = lines.filter((l) => !continued.has(l.id));

	const groups: LineageGroup[] = leaves.map((leaf) => {
		const items: LineageGroupItem[] = [];
		let current: ActLineMeta | undefined = leaf;
		const seen = new Set<string>();
		while (current && !seen.has(current.id)) {
			seen.add(current.id);
			const act = actById.get(current.actId);
			if (!act) break;
			items.push({ lineId: current.id, actId: act.id, actNumber: act.actNumber, name: current.name });
			current = act.continuesFromActLineId ? lineById.get(act.continuesFromActLineId) : undefined;
		}
		const leafAct = actById.get(leaf.actId);
		return {
			leafId: leaf.id,
			leafActId: leaf.actId,
			leafActNumber: leafAct?.actNumber ?? 0,
			leafName: leaf.name,
			leafCreatedAt: leaf.createdAt,
			items,
		};
	});

	groups.sort((a, b) => b.leafActNumber - a.leafActNumber || a.leafCreatedAt - b.leafCreatedAt);
	const toggleVisible = groups.length >= 2 && groups.some((g) => new Set(g.items.map((i) => i.actId)).size >= 2);
	return { groups, toggleVisible };
}

export async function getLineageGroupsForStory(storyId: string): Promise<LineageGroupsResult> {
	const [acts, lines] = await Promise.all([getActsForStory(storyId), getActLinesForStory(storyId)]);
	return computeLineageGroups(acts, lines);
}
