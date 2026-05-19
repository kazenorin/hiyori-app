import { buildMemoryTools } from '$lib/ai/tools/query-memories';
import { buildInventoryTools } from '$lib/ai/tools/query-inventory';
import { buildActPlotTools } from '$lib/ai/tools/read-act-plot';
import { buildSceneTools } from '$lib/ai/tools/read-scene';
import { buildRiskTools } from '$lib/ai/tools/evaluate-risk';
import { buildAdvancePhaseTools } from '$lib/ai/tools/advance-phase';
import { getStory, type Story } from '$lib/db/stories';
import { type ActLineMeta, getActLine } from '$lib/db/act-lines';
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
	WRITER: ['read-scene', 'query-memories', 'query-inventory', 'evaluate-risk', 'advance-phase'],
	REVIEWER: ['read-scene', 'query-memories', 'query-inventory'],
	EDITOR: ['advance-phase'],
	TEMPLATE_FITTER: [],
	GAME_MASTER: ['read-scene', 'query-memories', 'query-inventory', 'advance-phase'],
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

export async function buildTools(storyId: string, actLineId: string): Promise<ToolSet | undefined> {
	const [story, actLine] = await Promise.all([getStory(storyId), getActLine(actLineId)]);

	if (!story || !actLine) return undefined;

	const act = await getAct(actLine.actId);
	if (!act) return undefined;

	const ctx: ToolContext = { story, actLine, act };

	const advanceGuard = { hasAdvanced: false };

	const tools: ToolSet = {
		...buildMemoryTools(storyId, actLineId),
		...buildInventoryTools(storyId, actLineId),
		...buildActPlotTools(ctx),
		...buildSceneTools(ctx),
		...buildRiskTools(ctx),
	};

	if (actLine.plotMode === 'phaseEvent' && actLine.actPhase !== 'resolution') {
		Object.assign(tools, buildAdvancePhaseTools(actLine, advanceGuard));
	}

	return Object.keys(tools).length > 0 ? tools : undefined;
}
