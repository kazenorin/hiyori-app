import { generateActPlot, type ActPlotPhase } from '$lib/ai/act-plot/act-plot-generator';
import { getLineDir } from '$lib/ai/card-output-path';
import { resolveStoryFolder, loadStoryWorldContent } from '$lib/fs/story-folders';
import { writeTextFile, readTextFile, exists, mkdir, BaseDirectory } from '@tauri-apps/plugin-fs';
import type { EnsureActPlotParams } from '$lib/ai/act-plot/types';
import { log } from '$lib/logging/logger';
import * as dbActs from '$lib/db/acts';

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
	const worldContent = params.worldContent ?? (await loadStoryWorldContent(story.id, story.name));

	// Load act plot file
	const storyFolder = await resolveStoryFolder(story.id, story.name);
	const lineDir = await getLineDir(storyFolder, actNumber, actLine.isMainLine, actLine.id);
	const plotPath = `${lineDir}/${ACT_PLOT_FILENAME}`;
	const plotExists = await exists(plotPath, { baseDir: BaseDirectory.AppData });
	if (plotExists) {
		return await readTextFile(plotPath, { baseDir: BaseDirectory.AppData });
	} else {
		// Generate act plot if it doesn't exist yet

		if (params.onStartGenerate) {
			params.onStartGenerate();
		}

		const result = await generateActPlot({
			storyId: story.id,
			storyName: story.name,
			worldContent: worldContent,
			actLineId: actLine.id,
			isMainLine: actLine.isMainLine,
			actNumber: actNumber,
			plotMode: actLine.plotMode,
			isResumeGame: params.isResumeGame,
			onPhaseChange: params.onPhaseChange,
			abortSignal: params.abortSignal,
		});

		if (params.onGenerationComplete) {
			params.onGenerationComplete();
		}

		// Write output file

		await mkdir(lineDir, { baseDir: BaseDirectory.AppData, recursive: true });
		await writeTextFile(plotPath, result, { baseDir: BaseDirectory.AppData });

		await log.info(LOG_TAG, `Act-plot pipeline complete for actLine: ${actLine.id.slice(-8)} of story: ${story.id}`);

		return result;
	}
}

async function getActNumber(actId: string): Promise<number> {
	return (await dbActs.getActNumber(actId)) ?? 1;
}
