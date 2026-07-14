import { generateText, type ModelMessage } from 'ai';
import { getMainProviderConfig, isReviewerEnabled, settings } from '$lib/stores/settings.svelte';
import { createModel } from '$lib/ai/provider';
import {
	actPlotEditorPromptLoader,
	actPlotGenerationPromptLoader,
	actPlotReviewerPromptLoader,
	actPlotSystemPromptLoader,
	guidanceActPlotTemplateLoader,
	phaseEventActPlotTemplateLoader,
} from '$lib/fs/prompts';
import { log } from '$lib/logging/logger';
import {
	type ActLineMeta,
	getLastSceneNumber,
	getLatestTurnOfEvents,
	getPremisesMessages,
	getLatestActSummary,
	getActLine,
} from '$lib/db/act-lines';
import { traceActLineChain } from '$lib/db/acts';
import { ensureActCard } from '$lib/features/act-card-generator';
import { ensureCharacterCard, loadCharacterCardsForActLine, type CharacterCardContext } from '$lib/features/character-card-generator';
import { getLatestProfilesByActLine } from '$lib/db/character-profiles';
import { formatCharacterProfilesSection } from '$lib/definitions/pipeline-sections';
import { actPlotResumeNote } from '$lib/definitions/pipeline-prompts';
import { reviewerAcceptsAsIs } from '$lib/ai/reviewer-output-parser';
import { ACT_PLOT_SECTION } from '$lib/definitions/pipeline-sections';
import { targetWordCountPerSceneHeader } from '$lib/definitions/common-headers';
import { ERR_EMPTY_ACT_PLOT_WRITER, ERR_NO_MAIN_PROVIDER } from '$lib/definitions/error-messages';
import { actWithNumberLabel } from '$lib/definitions/common-labels';

const LOG_TAG = 'act-plot-generator';

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
	characterCards?: { preferredName: string; content: string }[];
	actCards?: { actNumber: number; content: string }[];
	characterProfiles?: string;
	useDetailedContext?: boolean;
}

function buildActPlotMessages(options: BuildActPlotMessagesOptions): ModelMessage[] {
	const {
		worldContent,
		previousActSummary,
		turnOfEvents,
		interviewTranscript,
		writerOutput,
		reviewerOutput,
		prompt,
		template,
		characterCards,
		actCards,
		characterProfiles,
		useDetailedContext,
	} = options;
	const messages: ModelMessage[] = [];
	const skipSummary = useDetailedContext === true;

	if (worldContent) {
		messages.push({ role: 'user', content: ACT_PLOT_SECTION.WORLD_CONTENT + worldContent });
	}

	if (useDetailedContext && characterCards?.length) {
		for (const card of characterCards) {
			messages.push({
				role: 'user',
				content: ACT_PLOT_SECTION.CHARACTER_CARDS + `### ${card.preferredName}\n\n---\n\n${card.content}`,
			});
		}
	}

	if (useDetailedContext && actCards?.length) {
		for (const card of actCards) {
			messages.push({
				role: 'user',
				content: ACT_PLOT_SECTION.ACT_CARDS + `### ${actWithNumberLabel(card.actNumber)}\n\n---\n\n${card.content}`,
			});
		}
	}

	if (useDetailedContext && characterProfiles) {
		messages.push({ role: 'user', content: ACT_PLOT_SECTION.CHARACTER_PROFILES + characterProfiles });
	}

	if (!skipSummary && previousActSummary) {
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
	actLine: ActLineMeta;
	actNumber: number;
	isResumeGame?: boolean;
	useDetailedContext?: boolean;
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
	const {
		storyId,
		storyName,
		worldContent,
		actLine,
		actNumber,
		isResumeGame = false,
		useDetailedContext,
		onPhaseChange,
		abortSignal,
	} = params;
	const config = getMainProviderConfig();
	if (!config?.model) {
		throw new Error(ERR_NO_MAIN_PROVIDER);
	}

	const actLineId = actLine.id;

	// Load prompts and context in parallel
	const actPlotTemplateLoader = actLine.plotMode === 'phaseEvent' ? phaseEventActPlotTemplateLoader : guidanceActPlotTemplateLoader;
	const [
		template,
		generationPrompt,
		systemPrompt,
		reviewerPrompt,
		editorPrompt,
		interviewTranscript,
		previousActSummary,
		turnOfEvents,
		detailedContext,
	] = await Promise.all([
		actPlotTemplateLoader
			.loadByStory(storyId, storyName)
			.then((p) => p.replace('{{targetWordCountPerSceneLabel}}', targetWordCountPerSceneHeader())),
		actPlotGenerationPromptLoader.loadByStory(storyId, storyName).then((p) => p.replace('{{actNumber}}', actNumber.toString())),
		actPlotSystemPromptLoader.loadByStory(storyId, storyName),
		actPlotReviewerPromptLoader.loadByStory(storyId, storyName),
		actPlotEditorPromptLoader.loadByStory(storyId, storyName),
		loadInterviewTranscript(actLineId),
		getLatestActSummary(actLineId),
		isResumeGame ? getLatestTurnOfEvents(actLineId) : Promise.resolve(null),
		useDetailedContext ? loadDetailedContextInputs(params) : Promise.resolve(null),
	]);

	const model = await createModel(config);

	await log.info(
		LOG_TAG,
		`Starting act-plot pipeline for story: ${storyName} (interview: ${interviewTranscript.some((m) => m.role === 'user') ? 'yes' : 'no'}, prev-summary: ${previousActSummary ? 'yes' : 'no'}, turnOfEvents: ${turnOfEvents ? 'yes' : 'no'}, detailedContext: ${detailedContext ? 'yes' : 'no'})`
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
		useDetailedContext,
		characterCards: detailedContext?.characterCards,
		actCards: detailedContext?.actCards,
		characterProfiles: detailedContext?.characterProfiles,
	});
	const writerResult = await generateText({
		model,
		system: systemPrompt,
		messages: writerMessages,
		abortSignal,
		...(config.callSettings ?? {}),
	});
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
				useDetailedContext,
				characterCards: detailedContext?.characterCards,
				actCards: detailedContext?.actCards,
				characterProfiles: detailedContext?.characterProfiles,
			});
			const reviewerResult = await generateText({
				model,
				system: systemPrompt,
				messages: reviewerMessages,
				abortSignal,
				...(config.callSettings ?? {}),
			});
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
					useDetailedContext,
					characterCards: detailedContext?.characterCards,
					actCards: detailedContext?.actCards,
					characterProfiles: detailedContext?.characterProfiles,
				});
				const editorResult = await generateText({
					model,
					system: systemPrompt,
					messages: editorMessages,
					abortSignal,
					...(config.callSettings ?? {}),
				});
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
		finalText = finalText + '\n\n' + actPlotResumeNote(lastSceneNumber.toString());
	}

	return finalText;
}

interface DetailedContext {
	actCards: { actNumber: number; content: string }[];
	characterCards: { preferredName: string; content: string }[];
	characterProfiles: string;
}

async function loadDetailedContextInputs(params: GenerateActPlotParams): Promise<DetailedContext> {
	const { storyId, storyName, actLine, actNumber } = params;

	// --- Act cards: trace lineage, excluding current act number ---
	const lineage = await traceActLineChain(actLine.id);
	const actCards: { actNumber: number; content: string }[] = [];
	for (const entry of lineage) {
		if (entry.actNumber === actNumber) continue;
		const lineageActLine = await getActLine(entry.actLineId);
		if (!lineageActLine) continue;
		const result = await ensureActCard({
			storyId,
			storyName,
			actLineId: entry.actLineId,
			actLine: lineageActLine,
			actNumber: entry.actNumber,
			abortSignal: params.abortSignal,
		});
		actCards.push({ actNumber: entry.actNumber, content: result.content });
	}
	actCards.sort((a, b) => a.actNumber - b.actNumber);

	// --- Character cards: reuse settings thresholds ---
	const profiles = await getLatestProfilesByActLine(actLine.id);
	const threshold = settings.characterProfileImportanceThreshold;
	const maxIncluded = settings.characterProfileMaxIncluded;
	const included = profiles
		.filter((p) => p.importance <= threshold)
		.sort((a, b) => a.importance - b.importance)
		.slice(0, maxIncluded);

	const ctx: CharacterCardContext = {
		storyId,
		storyName,
		actLineId: actLine.id,
		actLine,
		actNumber,
	};
	const characterCards: { preferredName: string; content: string }[] = [];
	const includedCanonicals = new Set<string>();
	for (const profile of included) {
		const result = await ensureCharacterCard({
			ctx,
			canonicalName: profile.canonicalName,
			preferredName: profile.preferredName,
			abortSignal: params.abortSignal,
		});
		characterCards.push({ preferredName: profile.preferredName, content: result.content });
		includedCanonicals.add(profile.canonicalName);
	}

	// Also include any existing cards whose canonical name matches a profile in this line
	const existing = await loadCharacterCardsForActLine(ctx);
	for (const card of existing) {
		if (includedCanonicals.has(card.canonicalName)) continue;
		const profile = profiles.find((p) => p.canonicalName === card.canonicalName);
		if (!profile) continue;
		characterCards.push({ preferredName: profile.preferredName, content: card.content });
		includedCanonicals.add(card.canonicalName);
	}

	const characterProfiles = formatCharacterProfilesSection(profiles, threshold, maxIncluded)[0] ?? '';

	return { actCards, characterCards, characterProfiles };
}
