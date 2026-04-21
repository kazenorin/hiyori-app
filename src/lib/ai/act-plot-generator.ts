import { generateText, type ModelMessage } from 'ai';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { createModel } from './provider';
import { loadActPlotTemplate, loadActPlotGenerationPrompt, loadStorySystemPrompt } from '$lib/fs/prompts';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { mkdir, writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { buildLineDir } from './card-output-path';
import { log } from '$lib/logging/logger';
import { getPremisesMessages } from '$lib/db/act-lines';

export interface GenerateActPlotResult {
	filePath: string;
	content: string;
}

/**
 * Load interview transcript from act_line_premises for a given act line.
 * Returns an array of ModelMessage objects (role + content only).
 */
export async function loadInterviewTranscript(actLineId: string): Promise<ModelMessage[]> {
	try {
		const premisesMessages = await getPremisesMessages(actLineId);
		return premisesMessages
			.filter((m) => m.role === 'user' || m.role === 'assistant')
			.map((m) => ({
				role: m.role as 'user' | 'assistant',
				content: m.content,
			}));
	} catch (err) {
		await log.error('act-plot-generator', 'Failed to load interview transcript', err);
		return [];
	}
}

/**
 * Generate an act-plot.md file for a newly created story's first act.
 * Uses world.md content and optional interview transcript to generate story structure and planning.
 *
 * Note: actNumber is hardcoded to 1 because this is only called from the
 * world builder flow, which always creates Act 1.
 *
 * @param storyId - The story's unique identifier
 * @param storyName - The story's display name
 * @param worldContent - The world.md content (already generated)
 * @param actLineId - The main act line ID (for path construction and interview lookup)
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

	// Load prompts and interview transcript in parallel
	const [template, generationPrompt, systemPrompt, interviewTranscript] = await Promise.all([
		loadActPlotTemplate(),
		loadActPlotGenerationPrompt(),
		loadStorySystemPrompt(storyId, storyName),
		loadInterviewTranscript(actLineId),
	]);

	const hasValidInterview = interviewTranscript.some((m) => m.role === 'user');

	const userMessages: ModelMessage[] = [
		{ role: 'user', content: 'The following is the world setting for the story.' },
		{ role: 'user', content: worldContent },
	];

	if (hasValidInterview) {
		userMessages.push({ role: 'user', content: 'The following is an interview exchange about the story and premises.' });
		userMessages.push(...interviewTranscript);
		userMessages.push({ role: 'user', content: 'Use the above information to generate an act plot.' });
	}

	userMessages.push({ role: 'user', content: generationPrompt });
	userMessages.push({ role: 'user', content: `## Template\n\n${template}` });

	const model = createModel(config);

	await log.info(
		'act-plot-generator',
		`Starting act-plot generation for story: ${storyName} (interview: ${hasValidInterview ? 'yes' : 'no'})`
	);

	try {
		const result = await generateText({
			model,
			system: systemPrompt,
			messages: userMessages,
		});

		// Validate response before writing
		const text = result.text.trim();
		if (!text) {
			// noinspection ExceptionCaughtLocallyJS
			throw new Error('LLM returned an empty response for act-plot generation.');
		}

		await log.info('act-plot-generator', `Act-plot generation complete. Tokens: ${result.usage.totalTokens}, Length: ${text.length} chars`);

		// Resolve output path: {storyFolder}/act-1/{lineSubDir}/act-plot.md
		const storyFolder = await resolveStoryFolder(storyId, storyName);
		const lineDir = buildLineDir(storyFolder, 1, isMainLine, actLineId);
		const filePath = `${lineDir}/act-plot.md`;

		// Write file
		await mkdir(lineDir, { baseDir: BaseDirectory.AppData, recursive: true });
		await writeTextFile(filePath, text, { baseDir: BaseDirectory.AppData });

		return { filePath, content: text };
	} catch (err) {
		await log.error('act-plot-generator', `Act-plot generation failed for story: ${storyName}`, err);
		throw err;
	}
}
