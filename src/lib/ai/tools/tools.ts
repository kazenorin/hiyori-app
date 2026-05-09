import { buildMemoryTools } from '$lib/ai/tools/query-memories';
import { buildActPlotTools } from '$lib/ai/tools/read-act-plot';
import { buildSceneTools } from '$lib/ai/tools/read-scene';
import { buildRiskTools } from '$lib/ai/tools/evaluate-risk';
import { getStory, type Story } from '$lib/db/stories';
import { getActLine, type ActLineMeta } from '$lib/db/act-lines';
import { getAct, type Act } from '$lib/db/acts';
import { type ToolSet } from 'ai';
import type { PhaseName } from '$lib/ai/narrative-types';

export interface ToolContext {
	story: Story;
	actLine: ActLineMeta;
	act: Act;
}

/** Maps each pipeline phase to the tool names it is allowed to use. */
export const PHASE_TOOLS: Record<PhaseName, readonly string[]> = {
	SUMMARIZER: [],
	PLOT_PLANNER: ['read-scene', 'query-memories'],
	WRITER: ['read-scene', 'query-memories', 'evaluate-risk'],
	REVIEWER: ['read-scene', 'query-memories'],
	EDITOR: [],
	TEMPLATE_FITTER: [],
	GAME_MASTER: ['read-scene', 'query-memories'],
};

/** Filter a full ToolSet down to only the tools allowed for a given phase. */
export function filterToolsForPhase(allTools: ToolSet | undefined, phase: PhaseName): ToolSet | undefined {
	if (!allTools) return undefined;
	const allowed = PHASE_TOOLS[phase];
	const filtered: ToolSet = {};
	for (const name of allowed) {
		if (name in allTools) {
			filtered[name] = allTools[name];
		}
	}
	return Object.keys(filtered).length > 0 ? filtered : undefined;
}

export async function buildTools(storyId: string, actLineId: string): Promise<ToolSet | undefined> {
	const [story, actLine] = await Promise.all([getStory(storyId), getActLine(actLineId)]);

	if (!story || !actLine) return undefined;

	const act = await getAct(actLine.actId);
	if (!act) return undefined;

	const ctx: ToolContext = { story, actLine, act };

	const tools: ToolSet = {
		...buildMemoryTools(storyId, actLineId),
		...buildActPlotTools(ctx),
		...buildSceneTools(ctx),
		...buildRiskTools(ctx),
	};

	return Object.keys(tools).length > 0 ? tools : undefined;
}
