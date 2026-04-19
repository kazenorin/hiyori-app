import {buildMemoryTools} from "$lib/ai/tools/query-memories";
import {type ToolSet} from 'ai';


export function buildTools(storyId: string, actLineId: string): ToolSet | undefined {
	const tools: ToolSet = {
		...buildMemoryTools(storyId, actLineId),
	};

	return Object.keys(tools).length > 0 ? tools : undefined;
}
