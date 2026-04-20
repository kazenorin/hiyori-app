import { tool } from 'ai';
import { z } from 'zod';
import { exists, readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { getStory } from '$lib/db/stories';
import { getActLine } from '$lib/db/act-lines';
import { getAct } from '$lib/db/acts';
import { buildLineDir } from '$lib/ai/card-output-path';
import { log } from '$lib/logging/logger';
import { type ToolSet } from 'ai';

export interface ReadActPlotContext {
	storyId: string;
	actLineId: string;
}

export function createReadActPlotTool(context: ReadActPlotContext) {
	const { storyId, actLineId } = context;

	const inputSchema = z.object({});

	return tool({
		description:
			"Read the act plot document for the current act. The act plot contains the story's planned structure: premise, target session count, major climactic events, possible endings, storytelling style, and presentation notes. Use this to understand the planned narrative arc and guide the story accordingly.",
		inputSchema,
		execute: async (): Promise<string> => {
			await log.debug('tool', `read-act-plot triggered for storyId=${storyId}, actLineId=${actLineId}`);

			// Look up story, act line, and act to build the file path
			const [story, actLine] = await Promise.all([getStory(storyId), getActLine(actLineId)]);

			if (!story) {
				return 'Error: Story not found.';
			}
			if (!actLine) {
				return 'Error: Act line not found.';
			}

			const act = await getAct(actLine.actId);
			if (!act) {
				return 'Error: Act not found.';
			}

			const storyFolder = await resolveStoryFolder(storyId, story.name);
			const lineDir = buildLineDir(storyFolder, act.actNumber, actLine.isMainLine, actLineId);
			const filePath = `${lineDir}/act-plot.md`;

			const fileExists = await exists(filePath, { baseDir: BaseDirectory.AppData });
			if (!fileExists) {
				return 'No act plot has been generated for this act yet.';
			}

			const content = await readTextFile(filePath, { baseDir: BaseDirectory.AppData });
			await log.debug('tool', `read-act-plot returned ${content.length} chars`);

			return content;
		},
	});
}

export function buildActPlotTools(storyId: string | null, actLineId: string): ToolSet {
	if (!storyId || !actLineId) return {};

	return {
		'read-act-plot': createReadActPlotTool({ storyId, actLineId }),
	};
}
