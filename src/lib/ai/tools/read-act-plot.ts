import { tool } from 'ai';
import { z } from 'zod';
import { exists, readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { buildLineDir, resolveLineDir } from '$lib/ai/card-output-path';
import { fileLog, log } from '$lib/logging/logger';
import { type ToolSet } from 'ai';
import type { ToolContext } from './tools';

export function createReadActPlotTool(ctx: ToolContext) {
	const { story, actLine, act } = ctx;

	const inputSchema = z.object({});

	return tool({
		description:
			"Read the act plot document for the current act. The act plot contains the story's planned structure: premise, target session count, major climactic events, possible endings, storytelling style, and presentation notes. Use this to understand the planned narrative arc and guide the story accordingly.",
		inputSchema,
		execute: async (): Promise<string> => {
			const logMessage = `read-act-plot triggered for storyId=${story.id}, actLineId=${actLine.id}`;
			await log.debug('tool', logMessage);
			await fileLog('debug', 'tool', logMessage);

			const storyFolder = await resolveStoryFolder(story.id, story.name);
			const lineDir = actLine.isMainLine
				? buildLineDir(storyFolder, act.actNumber, true, actLine.id)
				: await resolveLineDir(storyFolder, act.actNumber, actLine.id);
			const filePath = `${lineDir}/act-plot.md`;

			const fileExists = await exists(filePath, { baseDir: BaseDirectory.AppData });
			if (!fileExists) {
				return 'No act plot has been generated for this act yet.';
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
