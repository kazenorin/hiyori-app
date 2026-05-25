import { ls } from '$lib/localization';
import { tool } from 'ai';
import { z } from 'zod';
import { exists, readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { getLineDir } from '$lib/ai/card-output-path';
import { log } from './utils';
import { type ToolSet } from 'ai';
import type { ToolContext } from './tools';

export function createReadActPlotTool(ctx: ToolContext) {
	const { story, actLine, act } = ctx;

	const inputSchema = z.object({});

	return tool({
		description: ls('tools.readActPlot.description'),
		inputSchema,
		execute: async (): Promise<string> => {
			await log(`read-act-plot triggered for storyId=${story.id}, actLineId=${actLine.id}`);

			const storyFolder = await resolveStoryFolder(story.id, story.name);
			const lineDir = await getLineDir(storyFolder, act.actNumber, actLine.isMainLine, actLine.id);
			const filePath = `${lineDir}/act-plot.md`;

			const fileExists = await exists(filePath, { baseDir: BaseDirectory.AppData });
			if (!fileExists) {
				return ls('tools.readActPlot.messages.noActPlot');
			}

			const content = await readTextFile(filePath, { baseDir: BaseDirectory.AppData });
			await log(`read-act-plot returned ${content.length} chars`);

			return content;
		},
	});
}

export function buildActPlotTools(ctx: ToolContext): ToolSet {
	return {
		'read-act-plot': createReadActPlotTool(ctx),
	};
}
