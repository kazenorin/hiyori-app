import { buildMemoryTools } from '$lib/ai/tools/query-memories';
import { buildInventoryTools } from '$lib/ai/tools/query-inventory';
import { buildActPlotTools } from '$lib/ai/tools/read-act-plot';
import { buildSceneTools } from '$lib/ai/tools/read-scene';
import { buildRiskTools } from '$lib/ai/tools/evaluate-risk';
import { allowAdvancePhaseTools, buildAdvancePhaseTools } from '$lib/ai/tools/advance-phase';
import { allowEndActTools, buildEndActTools } from '$lib/ai/tools/end-act';
import { getStory, type Story } from '$lib/db/stories';
import { type ActLineMeta } from '$lib/db/act-lines';
import { type Act, getAct } from '$lib/db/acts';
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
	PLOT_PLANNER: ['read-scene', 'query-memories', 'query-inventory'],
	WRITER: ['read-scene', 'query-memories', 'query-inventory', 'evaluate-risk', 'advance-phase', 'end-act'],
	REVIEWER: ['read-scene', 'query-memories', 'query-inventory'],
	EDITOR: ['advance-phase', 'end-act'],
	TEMPLATE_FITTER: [],
	GAME_MASTER: ['read-scene', 'query-memories', 'query-inventory', 'advance-phase', 'end-act'],
	CHARACTER_PROFILE_COMPRESSOR: [],
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

export async function buildTools(storyId: string, actLine: ActLineMeta): Promise<ToolSet | undefined> {
	const story = await getStory(storyId);

	if (!story) return undefined;

	const act = await getAct(actLine.actId);
	if (!act) return undefined;

	const ctx: ToolContext = { story, actLine, act };

	const tools: ToolSet = {
		...buildMemoryTools(storyId, actLine.id),
		...buildInventoryTools(storyId, actLine.id),
		...buildActPlotTools(ctx),
		...buildSceneTools(ctx),
		...buildRiskTools(ctx),
	};

	if (allowAdvancePhaseTools(actLine)) {
		Object.assign(tools, buildAdvancePhaseTools(actLine));
	}

	if (allowEndActTools(actLine)) {
		Object.assign(tools, buildEndActTools(actLine));
	}

	return Object.keys(tools).length > 0 ? tools : undefined;
}
