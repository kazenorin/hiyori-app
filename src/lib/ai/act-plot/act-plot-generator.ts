import { generateText, type ModelMessage, isStepCount } from 'ai';
import { getMainProviderConfig, isReviewerEnabled, settings } from '$lib/stores/settings.svelte';
import { createModel } from '$lib/ai/provider';
import {
	actPlotEditorPromptLoader,
	guidanceActPlotGenerationPromptLoader,
	phaseEventActPlotGenerationPromptLoader,
	actPlotReviewerPromptLoader,
	actPlotSystemPromptLoader,
	generalInstructionsLoader,
	guidanceActPlotTemplateLoader,
	phaseEventActPlotTemplateLoader,
	interviewSummaryPromptLoader,
} from '$lib/fs/prompts';
import { log } from '$lib/logging/logger';
import {
	type ActLineMeta,
	getActLine,
	getLastSceneNumber,
	getLatestActSummary,
	getLatestTurnOfEvents,
	getPremisesMessages,
} from '$lib/db/act-lines';
import { getAct, traceActLineChain } from '$lib/db/acts';
import { getStory } from '$lib/db/stories';
import { checkActCardExists, ensureActCard } from '$lib/features/act-card-generator';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { fs } from '$lib/fs/file-system';
import {
	type CharacterCardContext,
	ensureCharacterCard,
	loadLatestCharacterCardsForActLine,
	toCharacterSummary,
} from '$lib/features/character-card-generator';
import { getLatestProfilesByActLine } from '$lib/db/character-profiles';
import { ACT_PLOT_SECTION, formatCharacterProfilesSection } from '$lib/definitions/pipeline-sections';
import { actPlotResumeNote, actPlotTailoredExperience } from '$lib/definitions/pipeline-prompts';
import { reviewerAcceptsAsIs } from '$lib/ai/reviewer-output-parser';
import { targetWordCountPerSceneHeader } from '$lib/definitions/common-headers';
import { ERR_EMPTY_ACT_PLOT_WRITER, ERR_NO_MAIN_PROVIDER } from '$lib/definitions/error-messages';
import { actWithNumberLabel } from '$lib/definitions/common-labels';
import { buildActPlotTools, filterActPlotToolsForPhase } from './tools';
import { ACT_LEVEL_ACT_CARD } from './constants';
import type { ActLineContext } from '$lib/ai/pipeline/types';
import type { ToolContext } from '$lib/ai/tools/tools';

const LOG_TAG = 'act-plot-generator';
const TOOL_MAX_STEPS = 10;

export type ActPlotPhase = 'summarizing' | 'writing' | 'reviewing' | 'editing';

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

/**
 * Summarize the interview transcript into a structured "Player Preferences" digest.
 * Fed into all act-plot phases (writer/reviewer/editor) as an explicit section so
 * small models can consume a compact, reviewable artifact instead of re-deriving
 * preferences from the raw brainstorming exchange each time.
 *
 * Returns null on any failure — non-blocking: the pipeline proceeds without the digest.
 */
async function summarizePlayerPreferences(params: {
	storyId: string;
	storyName: string;
	interviewTranscript: ModelMessage[];
	worldContent: string | null;
	previousActSummary: string | null;
	generalInstructions: string;
	model: Awaited<ReturnType<typeof createModel>>;
	callSettings: Record<string, unknown> | undefined;
	abortSignal?: AbortSignal;
}): Promise<string | null> {
	const {
		storyId,
		storyName,
		interviewTranscript,
		worldContent,
		previousActSummary,
		generalInstructions,
		model,
		callSettings,
		abortSignal,
	} = params;
	try {
		const promptTemplate = await interviewSummaryPromptLoader.loadByStory(storyId, storyName);
		const resolvedTemplate = promptTemplate.replace('{{generalInstructions}}', generalInstructions);
		const contextParts: string[] = [];
		if (worldContent) {
			contextParts.push(`${ACT_PLOT_SECTION.WORLD_CONTENT}${worldContent}`);
		}
		if (previousActSummary) {
			contextParts.push(`${ACT_PLOT_SECTION.PREVIOUS_ACT_SUMMARY}${previousActSummary}`);
		}
		const transcriptText = interviewTranscript.map((m) => `**${m.role === 'user' ? 'Player' : 'Interviewer'}**: ${m.content}`).join('\n\n');
		contextParts.push(`${ACT_PLOT_SECTION.INTERVIEW_TRANSCRIPT}${transcriptText}`);
		const userMessage = `${resolvedTemplate}\n\n${contextParts.join('\n\n')}`;

		const result = await generateText({
			model,
			messages: [{ role: 'user', content: userMessage }],
			abortSignal,
			...(callSettings ?? {}),
		});
		const text = result.text.trim();
		if (!text) {
			await log.warn(LOG_TAG, 'Player preferences summarization returned empty response');
			return null;
		}
		await log.info(LOG_TAG, `Player preferences digest complete. Tokens: ${result.usage.totalTokens}, Length: ${text.length} chars`);
		return text;
	} catch (err) {
		await log.warn(
			LOG_TAG,
			`Player preferences summarization failed, continuing without digest: ${err instanceof Error ? err.message : String(err)}`
		);
		return null;
	}
}

interface BuildActPlotMessagesOptions {
	prompt: string;
	worldContent: string | null;
	previousActSummary: string | null;
	turnOfEvents: string | null;
	interviewTranscript?: ModelMessage[];
	playerPreferences?: string | null;
	writerOutput?: string;
	reviewerOutput?: string;
	template?: string;
	characterCards?: { preferredName: string; content: string }[];
	actCards?: { actNumber: number; content: string }[];
	currentActCard?: { actNumber: number; content: string } | null;
	characterProfiles?: string;
	useDetailedContext?: boolean;
}

function buildActPlotMessages(options: BuildActPlotMessagesOptions): ModelMessage[] {
	const {
		worldContent,
		previousActSummary,
		turnOfEvents,
		interviewTranscript,
		playerPreferences,
		writerOutput,
		reviewerOutput,
		prompt,
		template,
		characterCards,
		actCards,
		currentActCard,
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

	if (currentActCard) {
		messages.push({
			role: 'user',
			content: ACT_PLOT_SECTION.ACT_CARDS + `### ${actWithNumberLabel(currentActCard.actNumber)}\n\n---\n\n${currentActCard.content}`,
		});
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

	if (playerPreferences && playerPreferences.trim()) {
		messages.push({ role: 'user', content: ACT_PLOT_SECTION.PLAYER_PREFERENCES + playerPreferences });
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
	const actPlotGenerationPromptLoader =
		actLine.plotMode === 'phaseEvent' ? phaseEventActPlotGenerationPromptLoader : guidanceActPlotGenerationPromptLoader;
	const [
		template,
		generationPrompt,
		systemPromptTemplate,
		generalInstructions,
		reviewerPrompt,
		editorPrompt,
		interviewTranscript,
		previousActSummary,
		turnOfEvents,
		detailedContext,
		toolContext,
		storyFolder,
	] = await Promise.all([
		actPlotTemplateLoader
			.loadByStory(storyId, storyName)
			.then((p) => p.replace('{{targetWordCountPerSceneLabel}}', targetWordCountPerSceneHeader())),
		actPlotGenerationPromptLoader.loadByStory(storyId, storyName).then((p) => p.replace('{{actNumber}}', actNumber.toString())),
		actPlotSystemPromptLoader.loadByStory(storyId, storyName),
		generalInstructionsLoader.loadByStory(storyId, storyName),
		actPlotReviewerPromptLoader.loadByStory(storyId, storyName),
		actPlotEditorPromptLoader.loadByStory(storyId, storyName),
		loadInterviewTranscript(actLineId),
		getLatestActSummary(actLineId),
		isResumeGame ? getLatestTurnOfEvents(actLineId) : Promise.resolve(null),
		useDetailedContext ? loadDetailedContextInputs(params) : Promise.resolve(null),
		loadActPlotToolContext(params),
		resolveStoryFolder(storyId, storyName),
	]);

	const systemPrompt = systemPromptTemplate
		.replace('{{generalInstructions}}', generalInstructions)
		.replace('{{tailoredExperience}}', interviewTranscript.some((m) => m.role === 'user') ? '\n' + actPlotTailoredExperience() : '');

	const currentActCard = await loadCurrentActLevelActCard(params, storyFolder);

	const model = await createModel(config);

	const allTools = toolContext
		? buildActPlotTools(toolContext, {
				includeDistant: actNumber > 1,
				includeCharacterDetails: !useDetailedContext,
			})
		: undefined;
	const writerTools = filterActPlotToolsForPhase(allTools, 'writer');
	const reviewerTools = filterActPlotToolsForPhase(allTools, 'reviewer');

	await log.info(
		LOG_TAG,
		`Starting act-plot pipeline for story: ${storyName} (interview: ${interviewTranscript.some((m) => m.role === 'user') ? 'yes' : 'no'}, prev-summary: ${previousActSummary ? 'yes' : 'no'}, turnOfEvents: ${turnOfEvents ? 'yes' : 'no'}, detailedContext: ${detailedContext ? 'yes' : 'no'}, currentActCard: ${currentActCard ? 'yes' : 'no'})`
	);

	// Phase 1: Summarize interview into a structured Player Preferences digest.
	// Runs only when an interview with user turns exists. Non-blocking on failure.
	const hasInterview = interviewTranscript.some((m) => m.role === 'user');
	let playerPreferences: string | null = null;
	if (hasInterview) {
		onPhaseChange?.('summarizing');
		await log.info(LOG_TAG, 'Phase 1: INTERVIEW SUMMARY');
		playerPreferences = await summarizePlayerPreferences({
			storyId,
			storyName,
			interviewTranscript,
			worldContent,
			previousActSummary,
			generalInstructions,
			model,
			callSettings: config.callSettings,
			abortSignal,
		});
	}

	// Phase 2: WRITER
	onPhaseChange?.('writing');
	await log.info(LOG_TAG, 'Phase 2: WRITER');

	const writerMessages = buildActPlotMessages({
		worldContent,
		previousActSummary,
		turnOfEvents,
		interviewTranscript,
		playerPreferences,
		prompt: generationPrompt,
		template,
		useDetailedContext,
		characterCards: detailedContext?.characterCards,
		actCards: detailedContext?.actCards,
		currentActCard,
		characterProfiles: detailedContext?.characterProfiles,
	});
	const writerResult = await generateText({
		model,
		instructions: systemPrompt,
		messages: writerMessages,
		abortSignal,
		...(config.callSettings ?? {}),
		...(writerTools ? { tools: writerTools, stopWhen: isStepCount(TOOL_MAX_STEPS) } : {}),
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
			// Phase 3: REVIEWER
			onPhaseChange?.('reviewing');
			await log.info(LOG_TAG, 'Phase 3: REVIEWER');

			const reviewerMessages = buildActPlotMessages({
				worldContent,
				previousActSummary,
				turnOfEvents,
				interviewTranscript,
				playerPreferences,
				writerOutput: writerText,
				prompt: reviewerPrompt,
				useDetailedContext,
				characterCards: detailedContext?.characterCards,
				actCards: detailedContext?.actCards,
				currentActCard,
				characterProfiles: detailedContext?.characterProfiles,
			});
			const reviewerResult = await generateText({
				model,
				instructions: systemPrompt,
				messages: reviewerMessages,
				abortSignal,
				...(config.callSettings ?? {}),
				...(reviewerTools ? { tools: reviewerTools, stopWhen: isStepCount(TOOL_MAX_STEPS) } : {}),
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
				// Phase 4: EDITOR
				onPhaseChange?.('editing');
				await log.info(LOG_TAG, 'Phase 4: EDITOR');

				const editorMessages = buildActPlotMessages({
					worldContent,
					previousActSummary,
					turnOfEvents,
					playerPreferences,
					writerOutput: writerText,
					reviewerOutput: reviewerText,
					prompt: editorPrompt,
					useDetailedContext,
					characterCards: detailedContext?.characterCards,
					actCards: detailedContext?.actCards,
					currentActCard,
					characterProfiles: detailedContext?.characterProfiles,
				});
				const editorResult = await generateText({
					model,
					instructions: systemPrompt,
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

async function loadActPlotToolContext(params: GenerateActPlotParams): Promise<ToolContext | undefined> {
	const { storyId, actLine, actNumber } = params;
	const story = await getStory(storyId);
	if (!story) return undefined;
	const act = await getAct(actLine.actId);
	if (!act) return undefined;
	const actLineContext: ActLineContext = {
		...actLine,
		currentActPhase: null,
		actPhaseBoundaries: [],
		lastPlotGeneration: null,
		actNumber,
		currentActPhaseLengthEstimate: null,
		currentScene: null,
	};
	return { story, actLine: actLineContext, act };
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
			character: toCharacterSummary(profile),
			abortSignal: params.abortSignal,
		});
		characterCards.push({ preferredName: profile.preferredName, content: result.content });
		includedCanonicals.add(profile.canonicalName);
	}

	// Also include any existing cards whose canonical name matches a profile in this line
	const existing = await loadLatestCharacterCardsForActLine(ctx);
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

/**
 * Load the act-level act card ({storyFolder}/act-{N}/{ACT_LEVEL_ACT_CARD}) for the current act.
 * This card is user-supplied (e.g. via import-world) and treated as generic context.
 * It is distinct from act-line-specific act cards (which hold message-id suffixes and
 * are loaded via loadDetailedContextInputs).
 *
 * In detailed context, the act-level card is skipped when an act-line-specific card
 * already exists for the current act line (the normal case), so current-act context
 * is not doubled up. Lineage act-line cards always take precedence over this card.
 */
async function loadCurrentActLevelActCard(
	params: GenerateActPlotParams,
	storyFolder: string
): Promise<{ actNumber: number; content: string } | null> {
	const { actNumber, useDetailedContext } = params;
	const filePath = `${storyFolder}/act-${actNumber}/${ACT_LEVEL_ACT_CARD}`;
	const exists = await fs.exists(filePath);
	if (!exists) return null;

	if (useDetailedContext) {
		const lineCardExists = await checkActCardExists({
			storyId: params.storyId,
			storyName: params.storyName,
			actLineId: params.actLine.id,
			actLine: params.actLine,
			actNumber,
			abortSignal: params.abortSignal,
		});
		if (lineCardExists) {
			await log.info(LOG_TAG, `Act-line card exists for act ${actNumber}; skipping act-level ${ACT_LEVEL_ACT_CARD}`);
			return null;
		}
	}

	try {
		const content = await fs.readTextFile(filePath);
		if (!content.trim()) return null;
		return { actNumber, content };
	} catch (err) {
		await log.warn(
			LOG_TAG,
			`Failed to read act-level ${ACT_LEVEL_ACT_CARD} for act ${actNumber}: ${err instanceof Error ? err.message : String(err)}`
		);
		return null;
	}
}
