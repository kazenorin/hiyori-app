import { stepCountIs, type ToolSet } from 'ai';
import { generateText } from 'ai';
import type { MessageBase } from '$lib/db/messages';
import { type ProviderConfig } from '$lib/stores/settings.svelte';
import { DEFAULT_RETRY_CONFIG, type RetryConfig, streamWithRetry } from './chat-stream';
import { createModel } from './provider';
import type { GameDataFields, NarrativeVariables, PhaseName } from './narrative-types';
import { SECTION, formatPreviousNarrativeBody, formatTurnOfEventsSection } from '$lib/definitions/section-constants';
import {
	gameMasterExtractionPrompt,
	editorExtractionPrompt,
	reviewerExtractionPromptTemplate,
	writerExtractionPromptTemplate,
	plotPlannerExtractionPromptTemplate,
	summarizerFallbackExtractionPromptTemplate,
	summarizerExtractionPromptTemplate,
	templateFitterSystemPrompt,
	editorTemplateFitterExtractionPrompt,
	gmTemplateFitterExtractionPrompt,
} from '$lib/definitions/static-prompts';
import type { AsyncPhaseResults, PipelineCallbacks, PipelineState } from './pipeline-types';
import type { StreamState } from './chat-callbacks';
import type { StreamResultMetadata } from './streaming';
import type { OutputDescriptor } from '$lib/chat-stream-parser/types';
import { variablesToMarkdown, hasTemplateMetadata } from './template-renderer';
import { runMemoryExtractionPipeline } from './memory-extraction-pipeline';
import { extractImportantPhrases } from './important-phrases-extractor';
import { isPhraseHighlightingEnabled } from '$lib/stores/settings.svelte';
import { filterToolsForPhase } from '$lib/ai/tools/tools';
import { log } from '$lib/logging/logger';
import {
	actSummaryIncrementalTemplateLoader,
	actSummaryTemplateLoader,
	editorSystemPromptLoader,
	gameMasterSystemPromptLoader,
	generalInstructionsLoader,
	plotPlannerSystemPromptLoader,
	type PromptLoader,
	reviewerSystemPromptTemplateLoader,
	summarizerIncrementalPromptLoader,
	summarizerPromptLoader,
	writerOutputTemplateLoader,
	writerSystemPromptLoader,
} from '$lib/fs/prompts';
import { mergeActSummary, parseActSummary, parseIncrementalOutput, serializeActSummary } from './act-summary-parser';
import { reviewerAcceptsAsIs } from './reviewer-output-parser';
import {
	NARRATIVE_DESCRIPTORS,
	REVIEWER_DESCRIPTORS,
	EDITOR_DESCRIPTORS,
	GAME_MASTER_DESCRIPTORS,
	PLOT_PLANNER_DESCRIPTORS,
	EDITOR_TEMPLATE_FITTER_DESCRIPTORS,
	GM_TEMPLATE_FITTER_DESCRIPTORS,
} from './descriptors';

const defaultTargetWordCount = 400;

// Dynamic prompts
const promptLoaderDefinitions = {
	generalInstructions: generalInstructionsLoader,
	plotPlannerSystemPrompt: plotPlannerSystemPromptLoader,
	writerSystemPrompt: writerSystemPromptLoader,
	writerOutputTemplate: writerOutputTemplateLoader,
	reviewerSystemPromptTemplate: reviewerSystemPromptTemplateLoader,
	editorSystemPrompt: editorSystemPromptLoader,
	gameMasterSystemPrompt: gameMasterSystemPromptLoader,
	summarizerPrompt: summarizerPromptLoader,
	actSummaryTemplate: actSummaryTemplateLoader,
	summarizerIncrementalPrompt: summarizerIncrementalPromptLoader,
	actSummaryIncrementalTemplate: actSummaryIncrementalTemplateLoader,
} satisfies Record<string, PromptLoader>;

type LoadedPrompts = Record<keyof typeof promptLoaderDefinitions, string>;

/**
 * Reconstruct full output text from a StreamState.
 * The narrative stream parser routes structured sections (Scene Title, Background,
 * Narrative Body, CG) into `variables` and accumulates all text in `content`.
 * For phases that output the writer template format, we combine both.
 */
function fullOutput(ss: StreamState): string {
	if (ss.variables && (ss.variables.sceneTitle || ss.variables.narrativeBody)) {
		return variablesToMarkdown(ss.variables);
	}
	return ss.content;
}

/** True if a string value is present (non-null and non-blank). */
function hasContent(value: string | null | undefined): value is string {
	return value != null && value.trim().length > 0;
}

/** Merge fitter variables with original, preferring original non-blank values. */
function mergeVariables(original: NarrativeVariables | null, fitter: NarrativeVariables | null): NarrativeVariables | null {
	if (!fitter) return original;
	if (!original) return fitter;
	return {
		sceneTitle: hasContent(original.sceneTitle) ? original.sceneTitle : fitter.sceneTitle,
		background: hasContent(original.background) ? original.background : fitter.background,
		narrativeBody: hasContent(original.narrativeBody) ? original.narrativeBody : fitter.narrativeBody,
		turnOfEvents: hasContent(original.turnOfEvents) ? original.turnOfEvents : fitter.turnOfEvents,
		cg: hasContent(original.cg) ? original.cg : fitter.cg,
		gameData: original.gameData ?? fitter.gameData,
	};
}

/** Merge fitter game data with original, preferring original non-empty values. */
function mergeGameData(original: GameDataFields | null, fitter: GameDataFields | null): GameDataFields | null {
	if (!fitter) return original;
	if (!original) return fitter;
	return {
		activePlotThreads: original.activePlotThreads.length > 0 ? original.activePlotThreads : fitter.activePlotThreads,
		decisionContext: hasContent(original.decisionContext) ? original.decisionContext : fitter.decisionContext,
		decisions: original.decisions.length > 0 ? original.decisions : fitter.decisions,
	};
}

export interface PipelineProviderConfigs {
	plotPlanner: ProviderConfig | undefined;
	writer: ProviderConfig | undefined;
	reviewer: ProviderConfig | undefined;
	editor: ProviderConfig | undefined;
	gameMaster: ProviderConfig | undefined;
	summarizer: ProviderConfig | undefined;
	minorTaskAgent: ProviderConfig | undefined;
}

/** Story identification context. All fields are present together or all absent. */
export interface StoryContext {
	storyId: string;
	storyName: string;
	actLineId: string;
}

/** Player response context. Both fields are present together or both absent. */
export interface PlayerContext {
	playerResponse: string;
	playerMessageId: string;
}

export interface PipelineExecution {
	providerConfigs: PipelineProviderConfigs;
	abortSignal: AbortSignal;
	tools?: ToolSet;
	callbacks: PipelineCallbacks;
}

export interface PipelineInput {
	execution: PipelineExecution;
	worldContent: string;
	actPlot: string;
	actSummary: string;
	previousNarrativeVariables: NarrativeVariables | undefined;
	previousScenePlot?: string;
	player?: PlayerContext;
	story?: StoryContext;
	completedScenes: number;
	targetWordCount?: number;
	retryConfig?: RetryConfig;
}

/** Parameters for a streaming pipeline phase. Shared fields come from base params. */
interface StreamingPhaseParams {
	phaseName: PhaseName;
	systemPrompt: string;
	messages: MessageBase[];
	providerConfig: ProviderConfig | undefined;
	abortSignal: AbortSignal;
	tools: ToolSet | undefined;
	callbacks: PipelineCallbacks;
	retryConfig: RetryConfig;
	descriptors: OutputDescriptor[];
	buildStateUpdate: (streamState: StreamState) => Partial<PipelineState>;
}

function updateState(prev: PipelineState, patch: Partial<PipelineState>): PipelineState {
	return { ...prev, ...patch };
}

/**
 * Execute a streaming phase with full lifecycle management (start, stream, complete, error).
 * All shared context (abort signal, tools, callbacks) comes from the params object.
 * Retries the entire phase (including buildStateUpdate) up to retryConfig.retryCount times.
 * Inner stream retries are deducted from the outer budget when streamWithRetry consumes them.
 */
async function executeStreamingPhase(
	params: StreamingPhaseParams,
	state: PipelineState
): Promise<{ state: PipelineState; streamState: StreamState; metadata: StreamResultMetadata }> {
	const { phaseName, systemPrompt, messages, providerConfig, abortSignal, tools, callbacks, retryConfig, descriptors, buildStateUpdate } =
		params;
	let remainingRetries = retryConfig.retryCount;
	let lastError: unknown;

	while (remainingRetries >= 0) {
		if (abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
		state = updateState(state, { currentPhase: phaseName });
		callbacks.onPhaseStart(phaseName);
		let streamResult: Awaited<ReturnType<typeof runStreamingPhase>> | undefined;
		try {
			streamResult = await runStreamingPhase(
				phaseName,
				systemPrompt,
				messages,
				providerConfig,
				abortSignal,
				tools,
				callbacks,
				{ retryCount: remainingRetries, backoffIntervalSeconds: retryConfig.backoffIntervalSeconds },
				descriptors
			);
			state = updateState(state, buildStateUpdate(streamResult.state));
			callbacks.onPhaseComplete(phaseName, state);
			return { state, streamState: streamResult.state, metadata: streamResult.metadata };
		} catch (err: unknown) {
			lastError = err;
			remainingRetries -= streamResult?.retriesConsumed ?? remainingRetries;
		}
	}

	callbacks.onError(phaseName, lastError);
	throw lastError;
}

/**
 * Run a single streaming phase with retry and return the accumulated stream state.
 */
async function runStreamingPhase(
	phaseName: PhaseName,
	systemPrompt: string,
	messages: MessageBase[],
	providerConfig: ProviderConfig | undefined,
	abortSignal: AbortSignal,
	tools: ToolSet | undefined,
	callbacks: PipelineCallbacks,
	retryConfig: RetryConfig,
	descriptors: OutputDescriptor[]
): Promise<{ state: StreamState; metadata: StreamResultMetadata; retriesConsumed: number }> {
	if (!providerConfig) {
		throw new Error(`No provider configured for ${phaseName}. Please set one in Settings.`);
	}

	let retriesConsumed = 0;
	const accumulator = await streamWithRetry(systemPrompt, messages, {
		retryConfig,
		onProgress: (streamState: StreamState) => {
			callbacks.onPhaseStream(phaseName, streamState);
		},
		onError: () => {
			// Intermediate attempt errors are logged here; the final error
			// is thrown and caught by executeStreamingPhase's catch block.
		},
		providerConfig,
		tools,
		abortSignal,
		descriptors,
		onRetry: callbacks.onPhaseRetry
			? (attempt: number, maxAttempts: number) => {
					callbacks.onPhaseRetry!(phaseName, attempt, maxAttempts);
					retriesConsumed++;
				}
			: undefined,
	});

	const metadata = await accumulator.resultMetadata;
	return { state: accumulator.state, metadata, retriesConsumed };
}

/**
 * Run a single non-streaming phase (e.g., Summarizer) and return the generated text.
 */
async function runNonStreamingPhase(
	phaseName: string,
	systemPrompt: string,
	messages: MessageBase[],
	providerConfig: ProviderConfig | undefined,
	abortSignal: AbortSignal,
	tools?: ToolSet,
	maxSteps: number = 10
): Promise<string> {
	if (!providerConfig) {
		throw new Error(`No provider configured for ${phaseName}. Please set one in Settings.`);
	}

	const model = createModel(providerConfig);
	const result = await generateText({
		model,
		messages,
		system: systemPrompt,
		abortSignal,
		...(tools && Object.keys(tools).length > 0 ? { tools } : {}),
		stopWhen: stepCountIs(maxSteps),
	});

	return result.text;
}

/**
 * Convert an array of content strings into user messages.
 */
function toUserMessages(contents: string[]): MessageBase[] {
	return contents.map((content) => ({ role: 'user' as const, content }));
}

async function loadPrompts(storyId: string | undefined, storyName: string | undefined): Promise<LoadedPrompts> {
	type Keys = keyof typeof promptLoaderDefinitions;
	const keys = Object.keys(promptLoaderDefinitions) as Keys[];

	const values = await Promise.all(
		storyId && storyName
			? keys.map((key) => promptLoaderDefinitions[key].loadByStory(storyId, storyName))
			: keys.map((key) => promptLoaderDefinitions[key].loadDefault())
	);

	return Object.fromEntries(keys.map((key, i) => [key, values[i]])) as LoadedPrompts;
}

function playerResponseSection(playerContext: PlayerContext | undefined) {
	const playerResponse = playerContext?.playerResponse;
	return playerResponse ? [SECTION.PLAYER_RESPONSE + playerResponse] : [];
}

function buildSummarizerMessages(input: PipelineInput) {
	const { previousNarrativeVariables, actSummary, completedScenes } = input;
	const sceneTitle = previousNarrativeVariables?.sceneTitle ?? '';
	const actSummaryHeading = SECTION.PREVIOUS_ACT_SUMMARY.replaceAll(
		'{summarizedScenes}',
		completedScenes <= 1 ? '' : `(up to Scene ${completedScenes - 1})`
	);

	if (previousNarrativeVariables && previousNarrativeVariables.narrativeBody) {
		return toUserMessages([
			actSummaryHeading + actSummary,
			SECTION.PREVIOUS_NARRATIVE_BODY + previousNarrativeVariables.narrativeBody,
			...playerResponseSection(input.player),
			...formatTurnOfEventsSection(previousNarrativeVariables.turnOfEvents),
			summarizerExtractionPromptTemplate.replaceAll('{completedScenes}', String(completedScenes)).replaceAll('{sceneTitle}', sceneTitle),
		]);
	} else {
		return toUserMessages([
			actSummaryHeading + actSummary,
			...playerResponseSection(input.player),
			summarizerFallbackExtractionPromptTemplate.replaceAll('{completedScenes}', String(completedScenes)),
		]);
	}
}

async function generateFullSummary(input: PipelineInput, loadedPrompts: LoadedPrompts) {
	const { summarizerPrompt, actSummaryTemplate } = loadedPrompts;
	const { execution } = input;
	const { providerConfigs, abortSignal } = execution;

	// === FIRST SUMMARY: Full generation (existing behavior) ===
	const summarizerSystemPrompt = summarizerPrompt.replaceAll('{actSummaryTemplate}', actSummaryTemplate);

	const summarizerMessages = buildSummarizerMessages(input);

	const rawSummary = await runNonStreamingPhase('SUMMARIZER', summarizerSystemPrompt, summarizerMessages, providerConfigs.summarizer, abortSignal);
	const { completedScenes, previousNarrativeVariables } = input;
	try {
		const parsed = parseActSummary(rawSummary);
		parsed.completedScenes = completedScenes;
		if (previousNarrativeVariables?.turnOfEvents) {
			parsed.turnOfEvents = previousNarrativeVariables.turnOfEvents;
			parsed.turnOfEventsSceneNumber = completedScenes;
			parsed.turnOfEventsSceneTitle = previousNarrativeVariables.sceneTitle ?? '';
		}
		return serializeActSummary(parsed);
	} catch {
		return rawSummary;
	}
}

async function generateIncrementalSummary(input: PipelineInput, loadedPrompts: LoadedPrompts) {
	const { actSummaryIncrementalTemplate, summarizerIncrementalPrompt } = loadedPrompts;
	const { actSummary, completedScenes, previousNarrativeVariables, execution } = input;
	const { providerConfigs, abortSignal } = execution;

	// === INCREMENTAL UPDATE: Parse, merge, serialize ===
	const sceneNumber = String(completedScenes);
	const sceneTitle = previousNarrativeVariables?.sceneTitle ?? '';
	const processedTemplate = actSummaryIncrementalTemplate
		.replaceAll('{completedScenes}', sceneNumber)
		.replaceAll('{sceneNumber}', sceneNumber)
		.replaceAll('{sceneTitle}', sceneTitle);

	const incrementalSystemPrompt = summarizerIncrementalPrompt.replaceAll('{actSummaryTemplate}', processedTemplate);

	const incrementalMessages = buildSummarizerMessages(input);
	const incrementalRaw = await runNonStreamingPhase(
		'SUMMARIZER',
		incrementalSystemPrompt,
		incrementalMessages,
		providerConfigs.summarizer,
		abortSignal
	);

	try {
		const existingParsed = parseActSummary(actSummary);
		const incrementalParsed = parseIncrementalOutput(incrementalRaw);
		const merged = mergeActSummary(existingParsed, incrementalParsed);
		// Override completedScenes with the programmatic value (more reliable than LLM-parsed)
		merged.completedScenes = completedScenes;
		// Inject turnOfEvents from previousNarrativeVariables (overwrites any existing)
		if (previousNarrativeVariables?.turnOfEvents) {
			merged.turnOfEvents = previousNarrativeVariables.turnOfEvents;
			merged.turnOfEventsSceneNumber = completedScenes;
			merged.turnOfEventsSceneTitle = previousNarrativeVariables.sceneTitle ?? '';
		}
		return serializeActSummary(merged);
	} catch (err) {
		await log.warn('pipeline', `Incremental act summary parse/merge failed, falling back to full summary: ${err}`);
		return generateFullSummary(input, loadedPrompts);
	}
}

export interface PipelineResult {
	state: PipelineState;
	editorMetadata?: StreamResultMetadata;
	asyncPhases?: Promise<AsyncPhaseResults>;
	importantPhrasesPromise?: Promise<string[] | null>;
}

/**
 * Run the full narrative generation pipeline.
 *
 * Sequential phases: Writer → Reviewer → Editor → [Game Master ‖ Plot Planner].
 * Game Master and Plot Planner run concurrently after Editor completes,
 * sharing the same context (editor output, act plot, etc.) with per-phase extraction prompts.
 * Async phases (Summarizer, then Memory Extraction) run concurrently with the
 * sequential chain and resolve afterward.
 * Editor LLM call is skipped when the reviewer indicates "accept as-is".
 * Context is passed as user messages, not stuffed into the system prompt.
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
	const {
		execution,
		worldContent,
		actPlot,
		actSummary,
		previousNarrativeVariables,
		previousScenePlot,
		player,
		story,
		completedScenes,
		targetWordCount,
	} = input;

	const { providerConfigs, abortSignal, tools, callbacks } = execution;

	const storyId = story?.storyId;
	const storyName = story?.storyName;
	const actLineId = story?.actLineId;

	const effectiveTargetWordCount = String(targetWordCount ?? defaultTargetWordCount);
	const currentScene = completedScenes > 0 ? String(completedScenes + 1) : '1';

	const previousNarrativeBody = previousNarrativeVariables?.narrativeBody;
	const previousTurnOfEvents = previousNarrativeVariables?.turnOfEvents;

	const retryConfig = input.retryConfig ?? DEFAULT_RETRY_CONFIG;

	const sharedParams = {
		abortSignal,
		callbacks,
		retryConfig,
	};

	let state: PipelineState = { currentPhase: null };
	let editorMetadata: StreamResultMetadata | undefined;

	// Load prompts — story-specific if storyId is provided, global otherwise
	const loadedPrompts = await loadPrompts(storyId, storyName);
	const {
		generalInstructions,
		writerSystemPrompt,
		writerOutputTemplate,
		reviewerSystemPromptTemplate,
		editorSystemPrompt,
		gameMasterSystemPrompt,
		plotPlannerSystemPrompt,
	} = loadedPrompts;

	// --- Async phases (Summarizer, then Memory) ---
	const asyncPhases = (async (): Promise<AsyncPhaseResults> => {
		if (player?.playerResponse && completedScenes > 0) {
			const newActSummary = actSummary
				? await generateIncrementalSummary(input, loadedPrompts)
				: await generateFullSummary(input, loadedPrompts);

			// Memory extraction depends on Summarizer result
			const playerMessageId = player.playerMessageId;
			if (previousNarrativeBody && actLineId && playerMessageId && storyId) {
				try {
					await runMemoryExtractionPipeline(previousNarrativeBody, storyId, actLineId, playerMessageId, newActSummary);
				} catch (err) {
					await log.error('memory-pipeline', 'Memory extraction failed', err);
				}
			}

			return { actSummary: newActSummary };
		}
		return {};
	})();

	// --- Sequential Phase 1: Writer ---
	{
		const result = await executeStreamingPhase(
			{
				phaseName: 'WRITER',
				systemPrompt: writerSystemPrompt
					.replaceAll('{generalInstructions}', generalInstructions)
					.replaceAll('{targetWordCount}', effectiveTargetWordCount)
					.replaceAll('{writerOutputTemplate}', writerOutputTemplate),
				...sharedParams,
				tools: filterToolsForPhase(tools, 'WRITER'),
				descriptors: NARRATIVE_DESCRIPTORS,
				messages: toUserMessages([
					SECTION.WORLD_CONTENT + worldContent,
					SECTION.ACT_PLOT + actPlot,
					SECTION.ACT_SUMMARY + actSummary,
					...(previousScenePlot ? [SECTION.SCENE_PLOT + previousScenePlot] : []),
					...formatPreviousNarrativeBody(previousNarrativeBody, completedScenes),
					...playerResponseSection(player),
					...formatTurnOfEventsSection(previousTurnOfEvents),
					writerExtractionPromptTemplate.replaceAll('{currentScene}', currentScene),
				]),
				providerConfig: providerConfigs.writer,
				buildStateUpdate: (ss) => ({
					writerOutput: fullOutput(ss),
					writerVariables: ss.variables,
				}),
			},
			state
		);
		state = result.state;
	}

	// --- Sequential Phase 2: Reviewer ---
	{
		const result = await executeStreamingPhase(
			{
				phaseName: 'REVIEWER',
				systemPrompt: reviewerSystemPromptTemplate.replaceAll('{generalInstructions}', generalInstructions),
				...sharedParams,
				tools: filterToolsForPhase(tools, 'REVIEWER'),
				descriptors: REVIEWER_DESCRIPTORS,
				messages: toUserMessages([
					SECTION.WORLD_CONTENT + worldContent,
					SECTION.ACT_PLOT + actPlot,
					SECTION.ACT_SUMMARY + actSummary,
					...(previousScenePlot ? [SECTION.SCENE_PLOT + previousScenePlot] : []),
					...formatPreviousNarrativeBody(previousNarrativeBody, completedScenes),
					...playerResponseSection(player),
					...formatTurnOfEventsSection(previousTurnOfEvents),
					...(state.writerOutput ? [SECTION.WRITER_OUTPUT + state.writerOutput] : []),
					reviewerExtractionPromptTemplate.replaceAll('{currentScene}', currentScene),
				]),
				providerConfig: providerConfigs.reviewer,
				buildStateUpdate: (ss) => ({ reviewerOutput: ss.content }),
			},
			state
		);
		state = result.state;
	}

	// --- Sequential Phase 3: Editor (skip LLM if reviewer accepts as-is) ---
	{
		const editorSkip = reviewerAcceptsAsIs(state.reviewerOutput);

		if (editorSkip) {
			state = updateState(state, {
				currentPhase: 'EDITOR',
				editorOutput: state.writerOutput,
				editorVariables: state.writerVariables ?? null,
				editorReasoning: null,
			});
			callbacks.onPhaseStart('EDITOR');
			callbacks.onPhaseComplete('EDITOR', state);
		} else {
			const result = await executeStreamingPhase(
				{
					phaseName: 'EDITOR',
					systemPrompt: editorSystemPrompt
						.replaceAll('{generalInstructions}', generalInstructions)
						.replaceAll('{targetWordCount}', effectiveTargetWordCount)
						.replaceAll('{writerOutputTemplate}', writerOutputTemplate),
					...sharedParams,
					tools: filterToolsForPhase(tools, 'EDITOR'),
					descriptors: EDITOR_DESCRIPTORS,
					messages: toUserMessages([
						SECTION.WORLD_CONTENT + worldContent,
						SECTION.ACT_PLOT + actPlot,
						SECTION.ACT_SUMMARY + actSummary,
						...(previousScenePlot ? [SECTION.SCENE_PLOT + previousScenePlot] : []),
						...formatPreviousNarrativeBody(previousNarrativeBody, completedScenes),
						...playerResponseSection(player),
						...formatTurnOfEventsSection(previousTurnOfEvents),
						...(state.writerOutput ? [SECTION.WRITER_OUTPUT + state.writerOutput] : []),
						...(state.reviewerOutput ? [SECTION.REVIEWER_OUTPUT + state.reviewerOutput] : []),
						editorExtractionPrompt,
					]),
					providerConfig: providerConfigs.editor,
					buildStateUpdate: (ss) => ({
						editorOutput: fullOutput(ss),
						editorVariables: ss.variables,
						editorReasoning: ss.reasoning,
					}),
				},
				state
			);
			state = result.state;
			editorMetadata = result.metadata;
		}
	}

	// --- Template fitting for Editor (if variables lack template metadata) ---
	if (!hasTemplateMetadata(state.editorVariables) && state.editorOutput) {
		const originalEditorVars = state.editorVariables ?? null;
		const fitterResult = await executeStreamingPhase(
			{
				phaseName: 'TEMPLATE_FITTER',
				systemPrompt: templateFitterSystemPrompt,
				...sharedParams,
				tools: undefined,
				descriptors: EDITOR_TEMPLATE_FITTER_DESCRIPTORS,
				messages: toUserMessages([
					SECTION.EDITOR_OUTPUT + (state.editorOutput ?? ''),
					SECTION.WRITER_OUTPUT_TEMPLATE + writerOutputTemplate,
					editorTemplateFitterExtractionPrompt,
				]),
				providerConfig: providerConfigs.minorTaskAgent,
				buildStateUpdate: (ss) => {
					const merged = mergeVariables(originalEditorVars, ss.variables);
					return {
						editorVariables: merged,
						editorOutput: merged ? variablesToMarkdown(merged) : state.editorOutput,
					};
				},
			},
			state
		);
		state = fitterResult.state;
	}

	// --- Important phrases extraction (after Editor, before GM/PlotPlanner) ---
	let importantPhrasesPromise: Promise<string[] | null> | undefined;
	if (isPhraseHighlightingEnabled()) {
		const narrativeBody = state.editorVariables?.narrativeBody;
		if (narrativeBody && narrativeBody.trim().length > 0) {
			importantPhrasesPromise = extractImportantPhrases(narrativeBody)
				.then((phrases) => (phrases.length > 0 ? phrases : null))
				.catch(async (err) => {
					await log.error('pipeline', 'Important phrases extraction failed', err);
					return null;
				});
		}
	}

	// --- Phase 4: Game Master + Plot Planner (concurrent) ---
	{
		const editorOutput = state.editorOutput ?? '';
		const sharedSections = [
			SECTION.ACT_PLOT + actPlot,
			SECTION.ACT_SUMMARY + actSummary,
			...(previousScenePlot ? [SECTION.SCENE_PLOT + previousScenePlot] : []),
			...formatPreviousNarrativeBody(previousNarrativeBody, completedScenes),
			...playerResponseSection(player),
			...formatTurnOfEventsSection(previousTurnOfEvents),
			// editorOutput (from variablesToMarkdown) may include a turnOfEvents section for the current scene,
			// which is distinct from previousTurnOfEvents above (the previous scene's).
			...(editorOutput ? [SECTION.EDITOR_OUTPUT + editorOutput] : []),
		];

		const [gmResult, plotResult] = await Promise.all([
			executeStreamingPhase(
				{
					phaseName: 'GAME_MASTER',
					systemPrompt: gameMasterSystemPrompt,
					...sharedParams,
					tools: filterToolsForPhase(tools, 'GAME_MASTER'),
					descriptors: GAME_MASTER_DESCRIPTORS,
					messages: toUserMessages([...sharedSections, gameMasterExtractionPrompt]),
					providerConfig: providerConfigs.gameMaster,
					buildStateUpdate: (ss) => ({
						gameMasterOutput: ss.content,
						gameData: ss.variables?.gameData ?? null,
					}),
				},
				state
			),
			executeStreamingPhase(
				{
					phaseName: 'PLOT_PLANNER',
					systemPrompt: plotPlannerSystemPrompt
						.replaceAll('{generalInstructions}', generalInstructions)
						.replaceAll('{targetWordCount}', effectiveTargetWordCount),
					...sharedParams,
					tools: filterToolsForPhase(tools, 'PLOT_PLANNER'),
					descriptors: PLOT_PLANNER_DESCRIPTORS,
					messages: toUserMessages([...sharedSections, plotPlannerExtractionPromptTemplate.replaceAll('{currentScene}', currentScene)]),
					providerConfig: providerConfigs.plotPlanner,
					buildStateUpdate: (ss) => ({
						scenePlot: ss.content,
					}),
				},
				state
			),
		]);

		state = gmResult.state;
		state = updateState(state, { scenePlot: plotResult.state.scenePlot });
	}

	// --- Template fitting for GM (if gameData lacks required structure) ---
	if (!state.gameData?.decisions?.length && state.gameMasterOutput) {
		const originalGameData = state.gameData ?? null;
		const gmFitterResult = await executeStreamingPhase(
			{
				phaseName: 'TEMPLATE_FITTER',
				systemPrompt: templateFitterSystemPrompt,
				...sharedParams,
				tools: undefined,
				descriptors: GM_TEMPLATE_FITTER_DESCRIPTORS,
				messages: toUserMessages([
					SECTION.EDITOR_OUTPUT + (state.editorOutput ?? ''),
					SECTION.GAME_MASTER_OUTPUT + (state.gameMasterOutput ?? ''),
					gmTemplateFitterExtractionPrompt,
				]),
				providerConfig: providerConfigs.minorTaskAgent,
				buildStateUpdate: (ss) => {
					const merged = mergeGameData(originalGameData, ss.variables?.gameData ?? null);
					return { gameData: merged };
				},
			},
			state
		);
		state = gmFitterResult.state;
	}

	state = updateState(state, { currentPhase: null });
	callbacks.onAllComplete(state);
	return { state, editorMetadata, asyncPhases, importantPhrasesPromise };
}
