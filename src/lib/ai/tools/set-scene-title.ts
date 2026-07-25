import { ls } from '$lib/localization';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { ToolContext } from './tools';
import type { NarrativeOverrides } from '$lib/ai/narrative-types';
import { log } from './utils';

export function createSetSceneTitleTool(ctx: ToolContext, overrides: NarrativeOverrides) {
	const { actLine } = ctx;

	const inputSchema = z.object({
		title: z.string().min(1).describe(ls('tools.setSceneTitle.parameters.title')),
	});

	return tool({
		description: ls('tools.setSceneTitle.description'),
		inputSchema,
		execute: async (input: z.infer<typeof inputSchema>): Promise<{ result: string }> => {
			const title = input.title.trim();
			overrides.sceneTitle = title;
			await log(`set-scene-title triggered: title=${title}, actLineId=${actLine.id}`);
			return { result: ls('tools.setSceneTitle.messages.success', { title }) };
		},
	});
}

export function buildSetSceneTitleTools(ctx: ToolContext, overrides: NarrativeOverrides): ToolSet {
	return {
		'set-scene-title': createSetSceneTitleTool(ctx, overrides),
	};
}
