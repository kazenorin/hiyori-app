import { ls } from '$lib/definitions/locale-strings';
import { tool } from 'ai';
import { z } from 'zod';
import { exists, readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { getLineDir } from '$lib/ai/card-output-path';
import { fileLog, log } from '$lib/logging/logger';
import { type ToolSet } from 'ai';
import type { ToolContext } from './tools';

export function createReadActPlotTool(ctx: ToolContext) {
	const { story, actLine, act } = ctx;

	const inputSchema = z.object({});

	return tool({
		description: ls('tools.readActPlot.description'),
		inputSchema,
		execute: async (): Promise<string> => {
			const logMessage = `read-act-plot triggered for storyId=${story.id}, actLineId=${actLine.id}`;
			await log.debug('tool', logMessage);
			await fileLog('debug', 'tool', logMessage);

			const storyFolder = await resolveStoryFolder(story.id, story.name);
			const lineDir = await getLineDir(storyFolder, act.actNumber, actLine.isMainLine, actLine.id);
			const filePath = `${lineDir}/act-plot.md`;

			const fileExists = await exists(filePath, { baseDir: BaseDirectory.AppData });
			if (!fileExists) {
				return ls('tools.readActPlot.messages.noActPlot');
			}

			const content = await readTextFile(filePath, { baseDir: BaseDirectory.AppData });
			const endLogMessage = `read-act-plot returned ${content.length} chars`;
			await log.debug('tool', endLogMessage);
			await fileLog('debug', 'tool', endLogMessage);

			return content;
		},
	});
}

export function buildActPlotTools(ctx: ToolContext): ToolSet {
	return {
		'read-act-plot': createReadActPlotTool(ctx),
	};
}
