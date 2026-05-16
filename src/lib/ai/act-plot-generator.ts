import { generateText, type ModelMessage } from 'ai';
import { getMainProviderConfig, isReviewerEnabled } from '$lib/stores/settings.svelte';
import { createModel } from './provider';
import {
	loadActPlotTemplate,
	loadActPlotGenerationPrompt,
	loadActPlotSystemPrompt,
	loadActPlotReviewerPrompt,
	loadActPlotEditorPrompt,
} from '$lib/fs/prompts';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { mkdir, writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { getLineDir } from './card-output-path';
import { log } from '$lib/logging/logger';
import { getLastSceneNumber, getPremisesMessages, getPreviousActSummary, getLatestTurnOfEvents } from '$lib/db/act-lines';
import { reviewerAcceptsAsIs } from './reviewer-output-parser';
import { ACT_PLOT_SECTION } from '$lib/definitions/pipeline-sections';
import { ERR_NO_MAIN_PROVIDER, ERR_EMPTY_ACT_PLOT_WRITER } from '$lib/definitions/error-messages';

const LOG_TAG = 'act-plot-generator';

const ACT_PLOT_RESUME_NOTE = `---

## Important Note

This Act Line is restarted from Scene {sceneNumber}, plot and events that happened at or prior to Scene {sceneNumber} may be have a different plot, or written from another perspective.`;

export interface GenerateActPlotResult {
	filePath: string;
	content: string;
}

export type ActPlotPhase = 'writing' | 'reviewing' | 'editing';

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
		await log.error(LOG_TAG, 'Failed to load interview transcript', err);
		return [];
	}
}

function buildWriterMessages(
	worldContent: string,
	interviewTranscript: ModelMessage[],
	previousActSummary: string | null,
	turnOfEvents: string | null,
	generationPrompt: string,
	template: string
): ModelMessage[] {
	const messages: ModelMessage[] = [{ role: 'user', content: ACT_PLOT_SECTION.WORLD_CONTENT + worldContent }];

	if (previousActSummary) {
		messages.push({ role: 'user', content: ACT_PLOT_SECTION.PREVIOUS_ACT_SUMMARY + previousActSummary });
	}

	const hasValidInterview = interviewTranscript.some((m) => m.role === 'user');
	if (hasValidInterview) {
		messages.push({ role: 'user', content: ACT_PLOT_SECTION.INTERVIEW_TRANSCRIPT });
		messages.push(...interviewTranscript);
	}

	if (turnOfEvents) {
		messages.push({ role: 'user', content: ACT_PLOT_SECTION.TURN_OF_EVENTS + turnOfEvents });
	}

	messages.push({ role: 'user', content: generationPrompt });
	messages.push({ role: 'user', content: ACT_PLOT_SECTION.TEMPLATE + template });

	return messages;
}

function buildReviewerMessages(
	worldContent: string,
	previousActSummary: string | null,
	turnOfEvents: string | null,
	writerOutput: string,
	reviewerPrompt: string
): ModelMessage[] {
	const messages: ModelMessage[] = [{ role: 'user', content: ACT_PLOT_SECTION.WORLD_CONTENT + worldContent }];

	if (previousActSummary) {
		messages.push({ role: 'user', content: ACT_PLOT_SECTION.PREVIOUS_ACT_SUMMARY + previousActSummary });
	}

	if (turnOfEvents) {
		messages.push({ role: 'user', content: ACT_PLOT_SECTION.TURN_OF_EVENTS + turnOfEvents });
	}

	messages.push({ role: 'user', content: ACT_PLOT_SECTION.WRITER_OUTPUT + writerOutput });
	messages.push({ role: 'user', content: reviewerPrompt });

	return messages;
}

function buildEditorMessages(
	worldContent: string,
	previousActSummary: string | null,
	turnOfEvents: string | null,
	writerOutput: string,
	reviewerOutput: string,
	editorPrompt: string
): ModelMessage[] {
	const messages: ModelMessage[] = [{ role: 'user', content: ACT_PLOT_SECTION.WORLD_CONTENT + worldContent }];

	if (previousActSummary) {
		messages.push({ role: 'user', content: ACT_PLOT_SECTION.PREVIOUS_ACT_SUMMARY + previousActSummary });
	}

	if (turnOfEvents) {
		messages.push({ role: 'user', content: ACT_PLOT_SECTION.TURN_OF_EVENTS + turnOfEvents });
	}

	messages.push({ role: 'user', content: ACT_PLOT_SECTION.WRITER_OUTPUT + writerOutput });
	messages.push({ role: 'user', content: ACT_PLOT_SECTION.REVIEWER_FEEDBACK + reviewerOutput });
	messages.push({ role: 'user', content: editorPrompt });

	return messages;
}

export interface GenerateActPlotParams {
	storyId: string;
	storyName: string;
	worldContent: string;
	actLineId: string;
	isMainLine: boolean;
	actNumber: number;
	isResumeGame?: boolean;
	onPhaseChange?: (phase: ActPlotPhase) => void;
}

/**
 * Generate an act-plot.md file using a 3-phase pipeline:
 * 1. WRITER — generates the initial act plot
 * 2. REVIEWER — evaluates the act plot for issues
 * 3. EDITOR — revises the act plot based on reviewer feedback (skipped if reviewer accepts)
 *
 * If the reviewer or editor phase fails, falls back to writer output.
 */
export async function generateActPlot(params: GenerateActPlotParams): Promise<GenerateActPlotResult> {
	const { storyId, storyName, worldContent, actLineId, isMainLine, actNumber, isResumeGame = false, onPhaseChange } = params;
	const config = getMainProviderConfig();
	if (!config?.apiKey) {
		throw new Error(ERR_NO_MAIN_PROVIDER);
	}

	// Load prompts and context in parallel
	const [template, generationPrompt, systemPrompt, reviewerPrompt, editorPrompt, interviewTranscript, previousActSummary, turnOfEvents] =
		await Promise.all([
			loadActPlotTemplate(),
			loadActPlotGenerationPrompt().then((p) => p.replace('{actNumber}', actNumber.toString())),
			loadActPlotSystemPrompt(),
			loadActPlotReviewerPrompt(),
			loadActPlotEditorPrompt(),
			loadInterviewTranscript(actLineId),
			getPreviousActSummary(actLineId),
			isResumeGame ? getLatestTurnOfEvents(actLineId) : Promise.resolve(null),
		]);

	const model = createModel(config);

	await log.info(
		LOG_TAG,
		`Starting act-plot pipeline for story: ${storyName} (interview: ${interviewTranscript.some((m) => m.role === 'user') ? 'yes' : 'no'}, prev-summary: ${previousActSummary ? 'yes' : 'no'}, turnOfEvents: ${turnOfEvents ? 'yes' : 'no'})`
	);

	// Phase 1: WRITER
	onPhaseChange?.('writing');
	await log.info(LOG_TAG, 'Phase 1: WRITER');

	const writerMessages = buildWriterMessages(
		worldContent,
		interviewTranscript,
		previousActSummary,
		turnOfEvents,
		generationPrompt,
		template
	);
	const writerResult = await generateText({ model, system: systemPrompt, messages: writerMessages });
	const writerText = writerResult.text.trim();

	if (!writerText) {
		throw new Error(ERR_EMPTY_ACT_PLOT_WRITER);
	}

	await log.info(LOG_TAG, `Writer complete. Tokens: ${writerResult.usage.totalTokens}, Length: ${writerText.length} chars`);

	// Phases 2+3: REVIEWER → EDITOR (skipped when reviewer disabled)
	let finalText: string;

	if (!isReviewerEnabled()) {
		await log.info(LOG_TAG, 'Reviewer disabled — skipping review/edit phases');
		finalText = writerText;
	} else {
		try {
			// Phase 2: REVIEWER
			onPhaseChange?.('reviewing');
			await log.info(LOG_TAG, 'Phase 2: REVIEWER');

			const reviewerMessages = buildReviewerMessages(worldContent, previousActSummary, turnOfEvents, writerText, reviewerPrompt);
			const reviewerResult = await generateText({ model, system: systemPrompt, messages: reviewerMessages });
			const reviewerText = reviewerResult.text.trim();

			await log.info(
				LOG_TAG,
				`Reviewer complete. Tokens: ${reviewerResult.usage.totalTokens}, Accepts-as-is: ${reviewerAcceptsAsIs(reviewerText)}`
			);

			if (reviewerAcceptsAsIs(reviewerText)) {
				await log.info(LOG_TAG, 'Editor phase skipped — reviewer accepted as-is');
				finalText = writerText;
			} else {
				// Phase 3: EDITOR
				onPhaseChange?.('editing');
				await log.info(LOG_TAG, 'Phase 3: EDITOR');

				const editorMessages = buildEditorMessages(worldContent, previousActSummary, turnOfEvents, writerText, reviewerText, editorPrompt);
				const editorResult = await generateText({ model, system: systemPrompt, messages: editorMessages });
				const editorText = editorResult.text.trim();

				if (!editorText) {
					await log.warn(LOG_TAG, 'Editor returned empty response, falling back to writer output');
					finalText = writerText;
				} else {
					finalText = editorText;
					await log.info(LOG_TAG, `Editor complete. Tokens: ${editorResult.usage.totalTokens}, Length: ${editorText.length} chars`);
				}
			}
		} catch (err) {
			await log.warn(LOG_TAG, `Review/edit phase failed, falling back to writer output: ${err instanceof Error ? err.message : String(err)}`);
			finalText = writerText;
		}
	}

	// Append resume-game note if applicable
	if (isResumeGame) {
		const lastSceneNumber = (await getLastSceneNumber(actLineId)) ?? 1;
		finalText = finalText + '\n\n' + ACT_PLOT_RESUME_NOTE.replaceAll('{sceneNumber}', lastSceneNumber.toString());
	}

	// Write output file
	const storyFolder = await resolveStoryFolder(storyId, storyName);
	const lineDir = await getLineDir(storyFolder, actNumber, isMainLine, actLineId);
	const filePath = `${lineDir}/act-plot.md`;

	await mkdir(lineDir, { baseDir: BaseDirectory.AppData, recursive: true });
	await writeTextFile(filePath, finalText, { baseDir: BaseDirectory.AppData });

	await log.info(LOG_TAG, `Act-plot pipeline complete for story: ${storyName}`);
	return { filePath, content: finalText };
}
