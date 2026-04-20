import { generateText } from 'ai';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { createModel } from './provider';
import { loadActPlotTemplate, loadActPlotGenerationPrompt, loadStorySystemPrompt } from '$lib/fs/prompts';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { mkdir, writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { buildLineDir } from './card-output-path';
import { log } from '$lib/logging/logger';

export interface GenerateActPlotResult {
	filePath: string;
	content: string;
}

/**
 * Generate an act-plot.md file for a newly created story's first act.
 * Uses world.md content to generate story structure and planning.
 *
 * @param storyId - The story's unique identifier
 * @param storyName - The story's display name
 * @param worldContent - The world.md content (already generated)
 * @param actLineId - The main act line ID (for path construction)
 * @param isMainLine - Whether this is the main story line
 */
export async function generateActPlot(
	storyId: string,
	storyName: string,
	worldContent: string,
	actLineId: string,
	isMainLine: boolean
): Promise<GenerateActPlotResult> {
	const config = getMainProviderConfig();
	if (!config?.apiKey) {
		throw new Error('No main provider configured. Please set one in Settings.');
	}

	// Load prompts in parallel
	const [template, generationPrompt, systemPrompt] = await Promise.all([
		loadActPlotTemplate(),
		loadActPlotGenerationPrompt(),
		loadStorySystemPrompt(storyId, storyName),
	]);

	// Build user message with world content, generation prompt, and template
	const userMessage = `The following is the world setting for the story. Use it to generate an act plot.

---

${worldContent}

---

${generationPrompt}

---

## Template

${template}`;

	const model = createModel(config);

	await log.info('act-plot-generator', `Starting act-plot generation for story: ${storyName}`);

	const result = await generateText({
		model,
		system: systemPrompt,
		messages: [{ role: 'user', content: userMessage }],
	});

	await log.info(
		'act-plot-generator',
		`Act-plot generation complete. Tokens: ${result.usage.totalTokens}`
	);

	// Resolve output path: {storyFolder}/act-1/{lineSubdir}/act-plot.md
	const storyFolder = await resolveStoryFolder(storyId, storyName);
	const lineDir = buildLineDir(storyFolder, 1, isMainLine, actLineId);
	const filePath = `${lineDir}/act-plot.md`;

	// Write file
	await mkdir(lineDir, { baseDir: BaseDirectory.AppData, recursive: true });
	await writeTextFile(filePath, result.text, { baseDir: BaseDirectory.AppData });

	return { filePath, content: result.text };
}
