import { generateText, type ModelMessage } from 'ai';
import type { PlotMode } from '$lib/ai/narrative-types';
import { getMainProviderConfig, isReviewerEnabled } from '$lib/stores/settings.svelte';
import { createModel } from '$lib/ai/provider';
import {
	loadActPlotTemplateForMode,
	loadActPlotGenerationPrompt,
	loadActPlotSystemPrompt,
	loadActPlotReviewerPrompt,
	loadActPlotEditorPrompt,
} from '$lib/fs/prompts';
import { log } from '$lib/logging/logger';
import { getLastSceneNumber, getPremisesMessages, getPreviousActSummary, getLatestTurnOfEvents } from '$lib/db/act-lines';
import { reviewerAcceptsAsIs } from '$lib/ai/reviewer-output-parser';
import { ACT_PLOT_SECTION } from '$lib/definitions/pipeline-sections';
import { ERR_NO_MAIN_PROVIDER, ERR_EMPTY_ACT_PLOT_WRITER } from '$lib/definitions/error-messages';

const LOG_TAG = 'act-plot-generator';

const ACT_PLOT_RESUME_NOTE = `---

## Important Note

This Act Line is restarted from Scene {sceneNumber}, plot and events that happened at or prior to Scene {sceneNumber} may be have a different plot, or written from another perspective.`;

export type ActPlotPhase = 'writing' | 'reviewing' | 'editing';

/**
 * Load interview transcript from act_line_premises for a given act line.
 * Returns an array of ModelMessage objects (role + content only).
 */
async function loadInterviewTranscript(actLineId: string): Promise<ModelMessage[]> {
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

interface BuildActPlotMessagesOptions {
	prompt: string;
	worldContent: string | null;
	previousActSummary: string | null;
	turnOfEvents: string | null;
	interviewTranscript?: ModelMessage[];
	writerOutput?: string;
	reviewerOutput?: string;
	template?: string;
}

function buildActPlotMessages(options: BuildActPlotMessagesOptions): ModelMessage[] {
	const { worldContent, previousActSummary, turnOfEvents, interviewTranscript, writerOutput, reviewerOutput, prompt, template } = options;
	const messages: ModelMessage[] = [];

	if (worldContent) {
		messages.push({ role: 'user', content: ACT_PLOT_SECTION.WORLD_CONTENT + worldContent });
	}

	if (previousActSummary) {
		messages.push({ role: 'user', content: ACT_PLOT_SECTION.PREVIOUS_ACT_SUMMARY + previousActSummary });
	}

	if (interviewTranscript) {
		const hasValidInterview = interviewTranscript.some((m) => m.role === 'user');
		if (hasValidInterview) {
			messages.push({ role: 'user', content: ACT_PLOT_SECTION.INTERVIEW_TRANSCRIPT });
			messages.push(...interviewTranscript);
		}
	}

	if (turnOfEvents) {
		messages.push({ role: 'user', content: ACT_PLOT_SECTION.TURN_OF_EVENTS + turnOfEvents });
	}

	if (writerOutput) {
		messages.push({ role: 'user', content: ACT_PLOT_SECTION.WRITER_OUTPUT + writerOutput });
	}

	if (reviewerOutput) {
		messages.push({ role: 'user', content: ACT_PLOT_SECTION.REVIEWER_FEEDBACK + reviewerOutput });
	}

	messages.push({ role: 'user', content: prompt });

	if (template) {
		messages.push({ role: 'user', content: ACT_PLOT_SECTION.TEMPLATE + template });
	}

	return messages;
}

export interface GenerateActPlotParams {
	storyId: string;
	storyName: string;
	worldContent: string | null;
	actLineId: string;
	isMainLine: boolean;
	actNumber: number;
	plotMode?: PlotMode;
	isResumeGame?: boolean;
	onPhaseChange?: (phase: ActPlotPhase) => void;
	abortSignal?: AbortSignal;
}

/**
 * Generate an act-plot.md file using a 3-phase pipeline:
 * 1. WRITER — generates the initial act plot
 * 2. REVIEWER — evaluates the act plot for issues
 * 3. EDITOR — revises the act plot based on reviewer feedback (skipped if reviewer accepts)
 *
 * If the reviewer or editor phase fails, falls back to writer output.
 */
export async function generateActPlot(params: GenerateActPlotParams): Promise<string> {
	const { storyName, worldContent, actLineId, actNumber, plotMode, isResumeGame = false, onPhaseChange, abortSignal } = params;
	const config = getMainProviderConfig();
	if (!config?.apiKey) {
		throw new Error(ERR_NO_MAIN_PROVIDER);
	}

	// Load prompts and context in parallel
	const [template, generationPrompt, systemPrompt, reviewerPrompt, editorPrompt, interviewTranscript, previousActSummary, turnOfEvents] =
		await Promise.all([
			loadActPlotTemplateForMode(plotMode ?? 'guidance'),
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

	const writerMessages = buildActPlotMessages({
		worldContent,
		previousActSummary,
		turnOfEvents,
		interviewTranscript,
		prompt: generationPrompt,
		template,
	});
	const writerResult = await generateText({ model, system: systemPrompt, messages: writerMessages, abortSignal });
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

			const reviewerMessages = buildActPlotMessages({
				worldContent,
				previousActSummary,
				turnOfEvents,
				writerOutput: writerText,
				prompt: reviewerPrompt,
			});
			const reviewerResult = await generateText({ model, system: systemPrompt, messages: reviewerMessages, abortSignal });
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

				const editorMessages = buildActPlotMessages({
					worldContent,
					previousActSummary,
					turnOfEvents,
					writerOutput: writerText,
					reviewerOutput: reviewerText,
					prompt: editorPrompt,
				});
				const editorResult = await generateText({ model, system: systemPrompt, messages: editorMessages, abortSignal });
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
			await log.warn(
				LOG_TAG,
				`Review/edit phase failed, falling back to writer output: ${err instanceof Error ? err.message : String(err)}`
			);
			finalText = writerText;
		}
	}

	// Append resume-game note if applicable
	if (isResumeGame) {
		const lastSceneNumber = (await getLastSceneNumber(actLineId)) ?? 1;
		finalText = finalText + '\n\n' + ACT_PLOT_RESUME_NOTE.replaceAll('{sceneNumber}', lastSceneNumber.toString());
	}

	return finalText;
}
