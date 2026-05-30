import { type ActPlotPhase, generateActPlot } from '$lib/ai/act-plot/act-plot-generator';
import { getLineDir } from '$lib/ai/card-output-path';
import { ensureWorldFile, resolveStoryFolder } from '$lib/fs/story-folders';
import { getFileSystem } from '$lib/fs/file-system';
import type { EnsureActPlotParams } from '$lib/ai/act-plot/types';
import { log } from '$lib/logging/logger';
import * as dbActs from '$lib/db/acts';

function fileFs() {
	return getFileSystem();
}

export type { ActPlotPhase };

const ACT_PLOT_FILENAME = 'act-plot.md';
const LOG_TAG = 'act-plot';

/**
 * Ensure the act plot file exists (generating it if needed) and load its content.
 */
export async function ensureActPlot(params: EnsureActPlotParams): Promise<string> {
	const story = params.story;
	const actLine = params.actLine;
	const actNumber = params.actNumber ?? (await getActNumber(actLine.actId));
	const worldContent = params.worldContent ?? (await ensureWorldFile(story.id, story.name, params.abortSignal));

	// Load act plot file
	const storyFolder = await resolveStoryFolder(story.id, story.name);
	const lineDir = await getLineDir(storyFolder, actNumber, actLine.isMainLine, actLine.id);
	const plotPath = `${lineDir}/${ACT_PLOT_FILENAME}`;
	const plotExists = await fileFs().exists(plotPath);
	if (plotExists) {
		return await fileFs().readTextFile(plotPath);
	} else {
		// Generate act plot if it doesn't exist yet

		params.onStartGenerate?.();

		const result = await generateActPlot({
			storyId: story.id,
			storyName: story.name,
			worldContent,
			actLine,
			actNumber,
			isResumeGame: params.isResumeGame,
			onPhaseChange: params.onPhaseChange,
			abortSignal: params.abortSignal,
		});

		params.onGenerationComplete?.();

		// Write output file

		await fileFs().writeTextFileEnsuringDir(plotPath, result);

		await log.info(LOG_TAG, `Act-plot pipeline complete for actLine: ${actLine.id.slice(-8)} of story: ${story.id}`);

		return result;
	}
}

async function getActNumber(actId: string): Promise<number> {
	return (await dbActs.getActNumber(actId)) ?? 1;
}
