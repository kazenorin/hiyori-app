import { buildMemoryTools } from '$lib/ai/tools/query-memories';
import { buildActPlotTools } from '$lib/ai/tools/read-act-plot';
import { buildSceneTools } from '$lib/ai/tools/read-scene';
import { getStory, type Story } from '$lib/db/stories';
import { getActLine, type ActLineMeta } from '$lib/db/act-lines';
import { getAct, type Act } from '$lib/db/acts';
import { type ToolSet } from 'ai';

export interface ToolContext {
	story: Story;
	actLine: ActLineMeta;
	act: Act;
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
	};

	return Object.keys(tools).length > 0 ? tools : undefined;
}
