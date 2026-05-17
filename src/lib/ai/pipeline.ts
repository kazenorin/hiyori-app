import {generateText, stepCountIs, type ToolSet} from 'ai';
import type {MessageBase} from '$lib/db/messages';
import {
	getSettings,
	isPhraseHighlightingEnabled,
	isPlotPlannerEnabled,
	isReviewerEnabled,
	type ProviderConfig,
} from '$lib/stores/settings.svelte';
import {DEFAULT_RETRY_CONFIG, type PhaseMetadata, type RetryConfig, streamWithRetry, toPhaseMetadata} from './chat-stream';
import {createModel} from './provider';
import type {GameDataFields, NarrativeVariables, PhaseName} from './narrative-types';
import {
	formatDirectorNotesSection,
	formatPreviousNarrativeBody,
	formatTurnOfEventsSection,
	SECTION,
} from '$lib/definitions/pipeline-sections';
import {actSummaryForScenesHeader, actSummaryHeader, sectionFormat, summaryHeader} from '$lib/definitions/common-headers';
import {aliasesLabel, locationLabel, sceneWithNumberLabel,} from '$lib/definitions/common-labels';
import {goalLabel, relationshipsLabel, stateLabel, upToLabel, voiceLabel,} from '$lib/definitions/character-profile-labels';
import {
	acceptAsIsLabel,
	characterProfilesHeader,
	characterSummariesHeader,
	editorExtractionPrompt,
	editorTemplateFitterExtractionPrompt,
	gameMasterExtractionPrompt,
	gmTemplateFitterExtractionPrompt,
	plotPlannerExtractionPromptTemplate,
	quickReviewerExtractionPromptTemplate,
	recommendationLabel,
	reviewerExtractionPromptTemplate,
	sceneSummariesHeader,
	summarizerExtractionPromptTemplate,
	summarizerFallbackExtractionPromptTemplate,
	templateFitterSystemPrompt,
	totalViolationsLabel,
	writerExtractionPromptTemplate,
} from '$lib/definitions/pipeline-prompts';
import type {AsyncPhaseResults, CompressorResult, PipelineCallbacks, PipelineState, SummarizerResult} from './pipeline-types';
import type {StreamState} from './chat-callbacks';
import {extractCacheTokens, type StreamResultMetadata} from './streaming';
import type {OutputDescriptor} from '$lib/chat-stream-parser/types';
import {hasTemplateMetadata, variablesToMarkdown} from './template-renderer';
import {runMemoryExtractionPipeline} from '$lib/features/memory/memory-extraction-pipeline';
import {extractImportantPhrases} from './important-phrases-extractor';
import {filterToolsForPhase} from '$lib/ai/tools/tools';
import {log} from '$lib/logging/logger';
import {ERR_NO_PROVIDER_FOR_PHASE} from '$lib/definitions/error-messages';
import {
	actSummaryIncrementalTemplateLoader,
	characterProfileCompressorPromptLoader,
	editorSystemPromptLoader,
	gameMasterSystemPromptLoader,
	generalInstructionsLoader,
	plotPlannerSystemPromptLoader,
	type PromptLoader,
	quickReviewerSystemPromptTemplateLoader,
	reviewerSystemPromptTemplateLoader,
	summarizerIncrementalPromptLoader,
	summarizerPromptLoader,
	writerOutputTemplateLoader,
	writerSystemPromptLoader,
} from '$lib/fs/prompts';
import {
	type ActSummary,
	mergeActSummary,
	parseActSummary,
	parseIncrementalOutput,
	parseProfilesBody,
	pruneCharacterScenes,
	serializeActSummary,
} from './act-summary-parser';
import {reviewerAcceptsAsIs} from './reviewer-output-parser';
import {
	getEditorDescriptors,
	getEditorTemplateFitterDescriptors,
	getGameMasterDescriptors,
	getGmTemplateFitterDescriptors,
	getNarrativeDescriptors,
	getPlotPlannerDescriptors,
	getReviewerDescriptors,
} from './descriptors';

const defaultTargetWordCount = 400;

function buildActSummaryTemplate(): string {
	const sceneLabel = sceneWithNumberLabel('{N}');
	return [
		sectionFormat(actSummaryHeader(), 1),
		sectionFormat(sceneSummariesHeader()),
		sectionFormat(`${sceneLabel}: [Scene title]`, 3),
		`${locationLabel()}: [location of where the scene took place.]`,
		`${summaryHeader()}: [summary, max 3 sentences]\n`,
		sectionFormat(characterSummariesHeader()),
		'### [Well-known name of the character]',
		`- ${aliasesLabel()}: [aliases]`,
		`- ${sceneLabel}: [summary if appeared, max 2 sentences. Optionally append one short, representative quote of dialogue or internal monologue.]`,
	].join('\n');
}

// Dynamic prompts
const promptLoaderDefinitions = {
	generalInstructions: generalInstructionsLoader,
	plotPlannerSystemPrompt: plotPlannerSystemPromptLoader,
	writerSystemPrompt: writerSystemPromptLoader,
	writerOutputTemplate: writerOutputTemplateLoader,
	reviewerSystemPromptTemplate: reviewerSystemPromptTemplateLoader,
	quickReviewerSystemPromptTemplate: quickReviewerSystemPromptTemplateLoader,
	editorSystemPrompt: editorSystemPromptLoader,
	gameMasterSystemPrompt: gameMasterSystemPromptLoader,
	summarizerPrompt: summarizerPromptLoader,
	summarizerIncrementalPrompt: summarizerIncrementalPromptLoader,
	actSummaryIncrementalTemplate: actSummaryIncrementalTemplateLoader,
	characterProfileCompressorPrompt: characterProfileCompressorPromptLoader,
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
	directorNotes: string;
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
	return {...prev, ...patch};
}

function aggregateMetadata(
	acc: StreamResultMetadata | null,
	phase: StreamResultMetadata,
	modelId: string | null | undefined
): StreamResultMetadata {
	if (!acc) {
		return {...phase, models: new Set(modelId ? [modelId] : [])};
	}
	return {
		finishReason: phase.finishReason,
		usage: {
			inputTokens: acc.usage.inputTokens + phase.usage.inputTokens,
			outputTokens: acc.usage.outputTokens + phase.usage.outputTokens,
			totalTokens: acc.usage.totalTokens + phase.usage.totalTokens,
			cacheReadTokens: (acc.usage.cacheReadTokens ?? 0) + (phase.usage.cacheReadTokens ?? 0) || undefined,
			cacheWriteTokens: (acc.usage.cacheWriteTokens ?? 0) + (phase.usage.cacheWriteTokens ?? 0) || undefined,
		},
		durationMs: acc.durationMs + phase.durationMs,
		models: new Set([...acc.models, ...(modelId ? [modelId] : [])]),
	};
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
	const {phaseName, systemPrompt, messages, providerConfig, abortSignal, tools, callbacks, retryConfig, descriptors, buildStateUpdate} =
		params;
	let remainingRetries = retryConfig.retryCount;
	let lastError: unknown;

	while (remainingRetries >= 0) {
		if (abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
		state = updateState(state, {currentPhase: phaseName});
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
				{retryCount: remainingRetries, backoffIntervalSeconds: retryConfig.backoffIntervalSeconds},
				descriptors
			);
			state = updateState(state, buildStateUpdate(streamResult.state));
			callbacks.onPhaseComplete(phaseName, state);
			return {state, streamState: streamResult.state, metadata: streamResult.metadata};
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
		throw new Error(ERR_NO_PROVIDER_FOR_PHASE(phaseName));
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
	return {state: accumulator.state, metadata, retriesConsumed};
}

/**
 * Run a single non-streaming phase (e.g., Summarizer) and return the generated text and metadata.
 */
async function runNonStreamingPhase(
	phaseName: string,
	systemPrompt: string,
	messages: MessageBase[],
	providerConfig: ProviderConfig | undefined,
	abortSignal: AbortSignal,
	tools?: ToolSet,
	maxSteps: number = 10
): Promise<{ text: string; metadata: StreamResultMetadata }> {
	if (!providerConfig) {
		throw new Error(ERR_NO_PROVIDER_FOR_PHASE(phaseName));
	}

	const model = createModel(providerConfig);
	const startTime = Date.now();
	const result = await generateText({
		model,
		messages,
		system: systemPrompt,
		abortSignal,
		...(tools && Object.keys(tools).length > 0 ? {tools} : {}),
		stopWhen: stepCountIs(maxSteps),
	});

	const usage = result.usage;
	const cacheTokens = extractCacheTokens(usage as unknown as Record<string, unknown>);
	return {
		text: result.text,
		metadata: {
			finishReason: result.finishReason ?? 'unknown',
			usage: {
				inputTokens: usage.inputTokens ?? 0,
				outputTokens: usage.outputTokens ?? 0,
				totalTokens: usage.totalTokens ?? 0,
				...cacheTokens,
			},
			durationMs: Date.now() - startTime,
			models: new Set(providerConfig.model ? [providerConfig.model] : []),
		},
	};
}

/**
 * Convert an array of content strings into user messages.
 */
function toUserMessages(contents: string[]): MessageBase[] {
	return contents.map((content) => ({role: 'user' as const, content}));
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

function formattedActSummaryForPhases(input: PipelineInput): string[] {
	const existingParsed = parseActSummary(input.actSummary);
	const serializedActSummary = serializeActSummary(pruneCharacterScenes(existingParsed));
	return [SECTION.ACT_SUMMARY + serializedActSummary]
}

/**
 *
 * @param completedScenes input.completedScenes
 * @param newActSummary Act summary generated by current Summarizer pipeline
 */
function formatActSummaryForCompressor(completedScenes: number, newActSummary: ActSummary): string[] {
	const actSummaryHeading = sectionFormat(`(${upToLabel()} ${sceneWithNumberLabel(completedScenes)})`);
	const summarizerActSummary = serializeActSummary({...newActSummary, characterProfiles: [], characterProfileLastScene: null});
	return summarizerActSummary ? [actSummaryHeading + summarizerActSummary] : [];
}

/**
 *
 * @param completedScenes `input.completedScenes`
 * @param actSummary `input.actSummary` or its preprocessed derivatives
 */
function formatActSummaryForSummarizer(completedScenes: number, actSummary: ActSummary): string[] {
	const actSummaryHeading = sectionFormat(actSummaryForScenesHeader(completedScenes <= 1 ? '' : `(${upToLabel()} ${sceneWithNumberLabel(completedScenes - 1)})`));
	const summarizerActSummary = serializeActSummary({...actSummary, characterProfiles: [], characterProfileLastScene: null});
	return summarizerActSummary ? [actSummaryHeading + summarizerActSummary] : [];
}

function buildSummarizerMessages(input: PipelineInput, parsedActSummary?: ActSummary) {
	const {previousNarrativeVariables, actSummary, completedScenes} = input;
	const sceneTitle = previousNarrativeVariables?.sceneTitle ?? '';

	const effectiveSummary = parsedActSummary ?? parseActSummary(actSummary);
	if (previousNarrativeVariables && previousNarrativeVariables.narrativeBody) {
		return toUserMessages([
			...formatActSummaryForSummarizer(completedScenes, effectiveSummary),
			...formatPreviousNarrativeBody(previousNarrativeVariables.narrativeBody, completedScenes),
			...playerResponseSection(input.player),
			...formatTurnOfEventsSection(previousNarrativeVariables.turnOfEvents),
			summarizerExtractionPromptTemplate(completedScenes, sceneTitle),
		]);
	} else {
		return toUserMessages([
			...formatActSummaryForSummarizer(completedScenes, effectiveSummary),
			...playerResponseSection(input.player),
			summarizerFallbackExtractionPromptTemplate(completedScenes),
		]);
	}
}

async function generateFullSummary(
	input: PipelineInput,
	loadedPrompts: LoadedPrompts
): Promise<SummarizerResult> {
	const {summarizerPrompt} = loadedPrompts;
	const {execution} = input;
	const {providerConfigs, abortSignal} = execution;

	// === FIRST SUMMARY: Full generation (existing behavior) ===
	const actSummaryTemplate = buildActSummaryTemplate();
	const summarizerSystemPrompt = summarizerPrompt.replaceAll('{actSummaryTemplate}', actSummaryTemplate);

	const summarizerMessages = buildSummarizerMessages(input);

	const {text: rawSummary, metadata} = await runNonStreamingPhase(
		'SUMMARIZER',
		summarizerSystemPrompt,
		summarizerMessages,
		providerConfigs.summarizer,
		abortSignal
	);
	const {completedScenes, previousNarrativeVariables} = input;
	try {
		const parsed = parseActSummary(rawSummary);
		parsed.completedScenes = completedScenes;
		if (previousNarrativeVariables?.turnOfEvents) {
			parsed.turnOfEvents = previousNarrativeVariables.turnOfEvents;
			parsed.turnOfEventsSceneNumber = completedScenes;
			parsed.turnOfEventsSceneTitle = previousNarrativeVariables.sceneTitle ?? '';
		}
		const serializedSummary = serializeActSummary(parsed);
		return {actSummary: parsed, serializedSummary, metadata};
	} catch {
		return {serializedSummary: rawSummary, metadata};
	}
}

async function generateIncrementalSummary(
	input: PipelineInput,
	loadedPrompts: LoadedPrompts
): Promise<SummarizerResult> {
	const {actSummaryIncrementalTemplate, summarizerIncrementalPrompt} = loadedPrompts;
	const {actSummary, completedScenes, previousNarrativeVariables, execution} = input;
	const {providerConfigs, abortSignal} = execution;

	const existingParsed = parseActSummary(actSummary);

	// === INCREMENTAL UPDATE: Parse, merge, serialize ===
	const sceneNumber = String(completedScenes);
	const sceneTitle = previousNarrativeVariables?.sceneTitle ?? '';
	const processedTemplate = actSummaryIncrementalTemplate
		.replace(/{sceneSummariesHeader}/g, sceneSummariesHeader())
		.replace(/{characterSummariesHeader}/g, characterSummariesHeader())
		.replace(/{sceneWithNumber}/g, sceneWithNumberLabel('{sceneNumber}'))
		.replace(/{locationLabel}/g, locationLabel())
		.replace(/{summaryHeader}/g, summaryHeader())
		.replace(/{aliasesLabel}/g, aliasesLabel())
		.replaceAll('{completedScenes}', sceneNumber)
		.replaceAll('{sceneNumber}', sceneNumber)
		.replaceAll('{sceneTitle}', sceneTitle);

	const incrementalSystemPrompt = summarizerIncrementalPrompt.replaceAll('{actSummaryTemplate}', processedTemplate);

	const incrementalMessages = buildSummarizerMessages(input, existingParsed);
	const {text: incrementalRaw, metadata} = await runNonStreamingPhase(
		'SUMMARIZER',
		incrementalSystemPrompt,
		incrementalMessages,
		providerConfigs.summarizer,
		abortSignal
	);

	try {
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
		const serializedSummary = serializeActSummary(merged);
		return {actSummary: merged, serializedSummary, metadata};
	} catch (err) {
		await log.warn('pipeline', `Incremental act summary parse/merge failed, falling back to full summary: ${err}`);
		return generateFullSummary(input, loadedPrompts);
	}
}

async function generateCharacterProfiles(
	newActSummary: ActSummary,
	input: PipelineInput,
	loadedPrompts: LoadedPrompts
): Promise<CompressorResult | null> {
	const {characterProfileCompressorPrompt} = loadedPrompts;
	const {completedScenes, execution} = input;
	const {providerConfigs, abortSignal} = execution;

	const settings = getSettings();
	const interval = settings.characterProfileCompressorInterval;
	if (interval <= 0) return null;

	// Check interval against the EXISTING act summary from DB
	const existingActSummary = parseActSummary(input.actSummary);
	const lastScene = existingActSummary.characterProfileLastScene ?? 0;

	if (completedScenes - lastScene < interval) return null;

	// Parse the LATEST act summary (post-Summarizer) for the compressor prompt
	// Build compressor system prompt with locale placeholders
	const compressorSystemPrompt = characterProfileCompressorPrompt
		.replaceAll('{actSummaryHeader}', actSummaryHeader())
		.replaceAll('{characterProfilesHeader}', characterProfilesHeader())
		.replaceAll('{stateLabel}', stateLabel())
		.replaceAll('{goalLabel}', goalLabel())
		.replaceAll('{relationshipsLabel}', relationshipsLabel())
		.replaceAll('{voiceLabel}', voiceLabel());

	// Build messages: full act summary WITHOUT the Character Profiles section
	const messages = toUserMessages(formatActSummaryForCompressor(input.completedScenes, newActSummary));

	const {text: rawProfiles, metadata} = await runNonStreamingPhase(
		'CHARACTER_PROFILE_COMPRESSOR',
		compressorSystemPrompt,
		messages,
		providerConfigs.summarizer,
		abortSignal
	);

	try {
		// The compressor output contains the Character Profiles section body
		const profilesResult = parseProfilesBody(rawProfiles);
		if (profilesResult.profiles.length === 0) return null;
		const updatedFullSummary = {...newActSummary, characterProfiles: profilesResult.profiles, characterProfileLastScene: completedScenes};
		return {
			characterProfiles: profilesResult.profiles,
			characterProfileLastScene: completedScenes,
			metadata,
			actSummary: updatedFullSummary,
			serializedSummary: serializeActSummary(updatedFullSummary)
		};
	} catch (err) {
		await log.warn('pipeline', `Character profile compressor parse failed: ${err}`);
		return null;
	}
}

export interface PipelineResult {
	state: PipelineState;
	aggregatedMetadata?: StreamResultMetadata;
	phases?: PhaseMetadata[];
	asyncPhases?: Promise<AsyncPhaseResults>;
}

/**
 * Run the full narrative generation pipeline.
 * Scene counting definitions:
 *   Completed scenes := scenes that have an assistant message followed by a player response
 *   Current scene := the scene the writer writes during the pipeline run (Scene number = completedScene + 1)
 *   Previous scene := the scene available as the narrative body, that does not have a summary covered yet (Scene number = completedScene)
 * 	 Player's response := user message that "completes" the previous scene (Scene number = completedScene)
 * 	 Summary generated by this run := The summary for the previous scene (Scene number = completedScene)
 * 	 Summary provided to writer/review/editor := input.actSummary, i.e. the summary generated for (Scene number = completedScene - 1)
 * 	 Summary provided to compressor := Summary provided to writer/review/editor (Scene number = completedScene)
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
		directorNotes,
		previousNarrativeVariables,
		previousScenePlot,
		player,
		story,
		completedScenes,
		targetWordCount,
	} = input;

	const {providerConfigs, abortSignal, tools, callbacks} = execution;

	const storyId = story?.storyId;
	const storyName = story?.storyName;
	const actLineId = story?.actLineId;

	const effectiveTargetWordCount = String(targetWordCount ?? defaultTargetWordCount);
	const currentScene = completedScenes > 0 ? String(completedScenes + 1) : '1'; // current = the scene the writer is going to write

	const previousNarrativeBody = previousNarrativeVariables?.narrativeBody;
	const previousTurnOfEvents = previousNarrativeVariables?.turnOfEvents;

	const retryConfig = input.retryConfig ?? DEFAULT_RETRY_CONFIG;

	const sharedParams = {
		abortSignal,
		callbacks,
		retryConfig,
	};

	let state: PipelineState = {currentPhase: null};
	let aggregatedMetadata: StreamResultMetadata | null = null;
	const phaseEntries: PhaseMetadata[] = [];

	// Load prompts — story-specific if storyId is provided, global otherwise
	const loadedPrompts = await loadPrompts(storyId, storyName);
	const {
		generalInstructions,
		writerSystemPrompt,
		writerOutputTemplate,
		reviewerSystemPromptTemplate,
		quickReviewerSystemPromptTemplate,
		editorSystemPrompt,
		gameMasterSystemPrompt,
		plotPlannerSystemPrompt,
	} = loadedPrompts;

	const reviewerPrompt = getSettings().reviewerMode === 'quick' ? quickReviewerSystemPromptTemplate : reviewerSystemPromptTemplate;

	// --- Async phases (Summarizer → Character Profile Compressor → Memory) ---
	const asyncPhases = (async (): Promise<AsyncPhaseResults> => {
		if (player?.playerResponse && completedScenes > 0) {
			// Summarizer receives full summary without Character Profiles section
			const result = actSummary
				? await generateIncrementalSummary(input, loadedPrompts)
				: await generateFullSummary(input, loadedPrompts);

			// Character Profile Compressor runs after Summarizer, using the latest summary
			let compressorResult: CompressorResult | null = null;
			try {
				if (result.actSummary) {
					compressorResult = await generateCharacterProfiles(result.actSummary, input, loadedPrompts);
				}
			} catch (err) {
				await log.warn('pipeline', `Character profile compressor failed: ${err}`);
			}

			// If compressor produced profiles, use its re-serialized actSummary (with profiles merged in)
			const serializedSummary = compressorResult?.serializedSummary ?? result?.serializedSummary;

			// Memory extraction depends on Summarizer result
			const playerMessageId = player.playerMessageId;
			if (previousNarrativeBody && actLineId && playerMessageId && storyId) {
				try {
					await runMemoryExtractionPipeline(previousNarrativeBody, storyId, actLineId, playerMessageId, serializedSummary);
				} catch (err) {
					await log.error('memory-pipeline', 'Memory extraction failed', err);
				}
			}

			return {
				actSummary: serializedSummary,
				summarizerMetadata: result.metadata,
				...(compressorResult
					? {
						characterProfiles: compressorResult.characterProfiles,
						characterProfileLastScene: compressorResult.characterProfileLastScene,
						compressorMetadata: compressorResult.metadata,
					}
					: {}),
			};
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
				descriptors: getNarrativeDescriptors(),
				messages: toUserMessages([
					SECTION.WORLD_CONTENT + worldContent,
					SECTION.ACT_PLOT + actPlot,
					...formattedActSummaryForPhases(input),
					...(previousScenePlot ? [SECTION.SCENE_PLOT + previousScenePlot] : []),
					...formatPreviousNarrativeBody(previousNarrativeBody, completedScenes),
					...playerResponseSection(player),
					...formatTurnOfEventsSection(previousTurnOfEvents),
					...formatDirectorNotesSection(directorNotes),
					writerExtractionPromptTemplate(currentScene),
				]),
				providerConfig: providerConfigs.writer,
				buildStateUpdate: (ss) => {
					const writerOutput = fullOutput(ss);
					const writerVariables = ss.variables;
					if (isReviewerEnabled()) {
						return {writerOutput, writerVariables};
					} else {
						return {
							writerOutput,
							writerVariables,
							editorOutput: writerOutput,
							editorVariables: writerVariables,
							editorReasoning: ss.reasoning,
						};
					}
				},
			},
			state
		);
		state = result.state;
		aggregatedMetadata = aggregateMetadata(aggregatedMetadata, result.metadata, providerConfigs.writer?.model);
		phaseEntries.push(toPhaseMetadata('WRITER', result.metadata, providerConfigs.writer?.model));
	}

	// --- Sequential Phase 2+3: Reviewer → Editor (skipped when reviewer disabled) ---
	if (!isReviewerEnabled()) {
		callbacks.onPhaseStart('EDITOR');
		state = updateState(state, {currentPhase: 'EDITOR'});
		callbacks.onPhaseComplete('EDITOR', state);
	} else {
		{
			const result = await executeStreamingPhase(
				{
					phaseName: 'REVIEWER',
					systemPrompt: reviewerPrompt
						.replaceAll('{generalInstructions}', generalInstructions)
						.replaceAll('{acceptAsIs}', acceptAsIsLabel())
						.replaceAll('{summary}', summaryHeader())
						.replaceAll('{totalViolations}', totalViolationsLabel())
						.replaceAll('{recommendation}', recommendationLabel()),
					...sharedParams,
					tools: filterToolsForPhase(tools, 'REVIEWER'),
					descriptors: getReviewerDescriptors(),
					messages: toUserMessages([
						SECTION.WORLD_CONTENT + worldContent,
						SECTION.ACT_PLOT + actPlot,
						...formattedActSummaryForPhases(input),
						...(previousScenePlot ? [SECTION.SCENE_PLOT + previousScenePlot] : []),
						...formatPreviousNarrativeBody(previousNarrativeBody, completedScenes),
						...playerResponseSection(player),
						...formatTurnOfEventsSection(previousTurnOfEvents),
						...formatDirectorNotesSection(directorNotes),
						...(state.writerOutput ? [SECTION.WRITER_OUTPUT + state.writerOutput] : []),
						getSettings().reviewerMode === 'quick'
							? quickReviewerExtractionPromptTemplate(currentScene)
							: reviewerExtractionPromptTemplate(currentScene),
					]),
					providerConfig: providerConfigs.reviewer,
					buildStateUpdate: (ss) => ({reviewerOutput: ss.content}),
				},
				state
			);
			state = result.state;
			aggregatedMetadata = aggregateMetadata(aggregatedMetadata, result.metadata, providerConfigs.reviewer?.model);
			phaseEntries.push(toPhaseMetadata('REVIEWER', result.metadata, providerConfigs.reviewer?.model));
		}

		// Phase 3: Editor (skip LLM if reviewer accepts as-is)
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
						descriptors: getEditorDescriptors(),
						messages: toUserMessages([
							SECTION.WORLD_CONTENT + worldContent,
							SECTION.ACT_PLOT + actPlot,
							...formattedActSummaryForPhases(input),
							...(previousScenePlot ? [SECTION.SCENE_PLOT + previousScenePlot] : []),
							...formatPreviousNarrativeBody(previousNarrativeBody, completedScenes),
							...playerResponseSection(player),
							...formatTurnOfEventsSection(previousTurnOfEvents),
							...formatDirectorNotesSection(directorNotes),
							...(state.writerOutput ? [SECTION.WRITER_OUTPUT + state.writerOutput] : []),
							...(state.reviewerOutput ? [SECTION.REVIEWER_OUTPUT + state.reviewerOutput] : []),
							editorExtractionPrompt(),
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
				aggregatedMetadata = aggregateMetadata(aggregatedMetadata, result.metadata, providerConfigs.editor?.model);
				phaseEntries.push(toPhaseMetadata('EDITOR', result.metadata, providerConfigs.editor?.model));
			}
		}
	}
	// --- Template fitting for Editor (if variables lack template metadata) ---
	if (!hasTemplateMetadata(state.editorVariables) && state.editorOutput) {
		const originalEditorVars = state.editorVariables ?? null;
		const fitterResult = await executeStreamingPhase(
			{
				phaseName: 'TEMPLATE_FITTER',
				systemPrompt: templateFitterSystemPrompt(),
				...sharedParams,
				tools: undefined,
				descriptors: getEditorTemplateFitterDescriptors(),
				messages: toUserMessages([
					SECTION.EDITOR_OUTPUT + (state.editorOutput ?? ''),
					SECTION.WRITER_OUTPUT_TEMPLATE + writerOutputTemplate,
					editorTemplateFitterExtractionPrompt(),
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
		aggregatedMetadata = aggregateMetadata(aggregatedMetadata, fitterResult.metadata, providerConfigs.minorTaskAgent?.model);
		phaseEntries.push(toPhaseMetadata('EDITOR_TEMPLATE_FITTER', fitterResult.metadata, providerConfigs.minorTaskAgent?.model));
	}

	// --- Important phrases extraction (after Editor, before GM/PlotPlanner) ---
	if (isPhraseHighlightingEnabled()) {
		const narrativeBody = state.editorVariables?.narrativeBody;
		if (narrativeBody && narrativeBody.trim().length > 0) {
			extractImportantPhrases(narrativeBody)
				.then((phrases) => {
					if (phrases.length > 0) {
						callbacks.onPhrasesExtracted?.(phrases);
					}
				})
				.catch(async (err) => {
					await log.error('pipeline', 'Important phrases extraction failed', err);
				});
		}
	}

	// --- Phase 4: Game Master + Plot Planner (concurrent, or Game Master only) ---
	{
		const editorOutput = state.editorOutput ?? '';
		const sharedSections = [
			SECTION.ACT_PLOT + actPlot,
			...formattedActSummaryForPhases(input),
			...(previousScenePlot ? [SECTION.SCENE_PLOT + previousScenePlot] : []),
			...formatPreviousNarrativeBody(previousNarrativeBody, completedScenes),
			...playerResponseSection(player),
			...formatTurnOfEventsSection(previousTurnOfEvents),
			// editorOutput (from variablesToMarkdown) may include a turnOfEvents section for the current scene,
			// which is distinct from previousTurnOfEvents above (the previous scene's).
			...(editorOutput ? [SECTION.EDITOR_OUTPUT + editorOutput] : []),
			...formatDirectorNotesSection(directorNotes),
		];

		if (isPlotPlannerEnabled()) {
			const [gmResult, plotResult] = await Promise.all([
				executeStreamingPhase(
					{
						phaseName: 'GAME_MASTER',
						systemPrompt: gameMasterSystemPrompt,
						...sharedParams,
						tools: filterToolsForPhase(tools, 'GAME_MASTER'),
						descriptors: getGameMasterDescriptors(),
						messages: toUserMessages([...sharedSections, gameMasterExtractionPrompt()]),
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
						descriptors: getPlotPlannerDescriptors(),
						messages: toUserMessages([...sharedSections, plotPlannerExtractionPromptTemplate(currentScene)]),
						providerConfig: providerConfigs.plotPlanner,
						buildStateUpdate: (ss) => ({
							scenePlot: ss.content,
						}),
					},
					state
				),
			]);

			state = gmResult.state;
			state = updateState(state, {scenePlot: plotResult.state.scenePlot});
			aggregatedMetadata = aggregateMetadata(aggregatedMetadata, gmResult.metadata, providerConfigs.gameMaster?.model);
			phaseEntries.push(toPhaseMetadata('GAME_MASTER', gmResult.metadata, providerConfigs.gameMaster?.model));
			aggregatedMetadata = aggregateMetadata(aggregatedMetadata, plotResult.metadata, providerConfigs.plotPlanner?.model);
			phaseEntries.push(toPhaseMetadata('PLOT_PLANNER', plotResult.metadata, providerConfigs.plotPlanner?.model));
		} else {
			const gmResult = await executeStreamingPhase(
				{
					phaseName: 'GAME_MASTER',
					systemPrompt: gameMasterSystemPrompt,
					...sharedParams,
					tools: filterToolsForPhase(tools, 'GAME_MASTER'),
					descriptors: getGameMasterDescriptors(),
					messages: toUserMessages([...sharedSections, gameMasterExtractionPrompt()]),
					providerConfig: providerConfigs.gameMaster,
					buildStateUpdate: (ss) => ({
						gameMasterOutput: ss.content,
						gameData: ss.variables?.gameData ?? null,
					}),
				},
				state
			);

			state = gmResult.state;
			aggregatedMetadata = aggregateMetadata(aggregatedMetadata, gmResult.metadata, providerConfigs.gameMaster?.model);
			phaseEntries.push(toPhaseMetadata('GAME_MASTER', gmResult.metadata, providerConfigs.gameMaster?.model));
		}
	}

	// --- Template fitting for GM (if gameData lacks required structure) ---
	if (!state.gameData?.decisions?.length && state.gameMasterOutput) {
		const originalGameData = state.gameData ?? null;
		const gmFitterResult = await executeStreamingPhase(
			{
				phaseName: 'TEMPLATE_FITTER',
				systemPrompt: templateFitterSystemPrompt(),
				...sharedParams,
				tools: undefined,
				descriptors: getGmTemplateFitterDescriptors(),
				messages: toUserMessages([
					SECTION.EDITOR_OUTPUT + (state.editorOutput ?? ''),
					SECTION.GAME_MASTER_OUTPUT + (state.gameMasterOutput ?? ''),
					gmTemplateFitterExtractionPrompt(),
				]),
				providerConfig: providerConfigs.minorTaskAgent,
				buildStateUpdate: (ss) => {
					const merged = mergeGameData(originalGameData, ss.variables?.gameData ?? null);
					return {gameData: merged};
				},
			},
			state
		);
		state = gmFitterResult.state;
		aggregatedMetadata = aggregateMetadata(aggregatedMetadata, gmFitterResult.metadata, providerConfigs.minorTaskAgent?.model);
		phaseEntries.push(toPhaseMetadata('GM_TEMPLATE_FITTER', gmFitterResult.metadata, providerConfigs.minorTaskAgent?.model));
	}

	state = updateState(state, {currentPhase: null});
	callbacks.onAllComplete(state);
	return {
		state,
		aggregatedMetadata: aggregatedMetadata ?? undefined,
		phases: phaseEntries.length > 0 ? phaseEntries : undefined,
		asyncPhases,
	};
}
