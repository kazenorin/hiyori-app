import { stepCountIs, type ToolSet } from 'ai';
import { generateText } from 'ai';
import type { MessageBase } from '$lib/db/messages';
import type { ProviderConfig } from '$lib/stores/settings.svelte';
import { DEFAULT_RETRY_CONFIG, type RetryConfig, streamWithRetry } from './chat-stream';
import { createModel } from './provider';
import type { NarrativeVariables, PhaseName } from './narrative-types';
import type { AsyncPhaseResults, PipelineCallbacks, PipelineState } from './pipeline-types';
import type { StreamState } from './chat-callbacks';
import type { StreamResultMetadata } from './streaming';
import type { OutputDescriptor } from '$lib/chat-stream-parser/types';
import { variablesToMarkdown } from './template-renderer';
import { runMemoryExtractionPipeline } from './memory-extraction-pipeline';
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
import { NARRATIVE_DESCRIPTORS, REVIEWER_DESCRIPTORS, EDITOR_DESCRIPTORS, GAME_MASTER_DESCRIPTORS } from './descriptors';

// Markdown section headings used in phase prompts
const SECTION = {
	WORLD_CONTENT: '\n## World Content\n',
	ACT_PLOT: '\n## Act Plot\n',
	ACT_SUMMARY: '\n## Act Summary\n',
	PLAYER_RESPONSE: '\n## Player Response\n',
	SCENE_PLOT: '\n## Scene Plot\n',
	WRITER_OUTPUT_TEMPLATE: '\n## Writer Output Template\n',
	WRITER_OUTPUT: '\n## Writer Output\n',
	REVIEWER_OUTPUT: '\n## Reviewer Output\n',
	EDITOR_OUTPUT: '\n## Editor Output\n',
	PREVIOUS_ACT_SUMMARY: '\n## Previous Act Summary\n',
	PREVIOUS_NARRATIVE_BODY: '\n## Previous Narrative Body\n',
	EXISTING_ACT_SUMMARY: '\n## Existing Act Summary\n',
};

// Hardcoded prompts
const gameMasterExtractionPrompt = 'Generate the game data based on the available information in the chat history.';
const editorExtractionPrompt =
	'Apply suggestions from the reviewer output to the writer output. ' +
	'Judge whether the suggestions are necessary based on the available information in the chat history.';
const reviewerExtractionPrompt = `Perform a review on the writer's output based on the available information in the chat history.`;
const writerExtractionPrompt = 'Write a story prose based on the available information in the chat history.';
const plotPlannerExtractionPrompt = 'Generate a Scene Plot based on the available information in the chat history.';

const summarizerFallbackExtractionPromptTemplate = 'Update the Act Summary for Scene {completedScenes} based on the Player Response.';
const summarizerExtractionPromptTemplate =
	'Update the Act Summary adding information for the previous scene: "Scene {completedScenes}: {sceneTitle}"';

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

export interface PipelineProviderConfigs {
	plotPlanner: ProviderConfig | undefined;
	writer: ProviderConfig | undefined;
	reviewer: ProviderConfig | undefined;
	editor: ProviderConfig | undefined;
	gameMaster: ProviderConfig | undefined;
	summarizer: ProviderConfig | undefined;
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
 */
async function executeStreamingPhase(
	params: StreamingPhaseParams,
	state: PipelineState
): Promise<{ state: PipelineState; streamState: StreamState; metadata: StreamResultMetadata }> {
	const { phaseName, systemPrompt, messages, providerConfig, abortSignal, tools, callbacks, retryConfig, descriptors, buildStateUpdate } =
		params;
	state = updateState(state, { currentPhase: phaseName });
	callbacks.onPhaseStart(phaseName);
	try {
		const result = await runStreamingPhase(
			phaseName,
			systemPrompt,
			messages,
			providerConfig,
			abortSignal,
			tools,
			callbacks,
			retryConfig,
			descriptors
		);
		state = updateState(state, buildStateUpdate(result.state));
		callbacks.onPhaseComplete(phaseName, state);
		return { state, streamState: result.state, metadata: result.metadata };
	} catch (err: unknown) {
		callbacks.onError(phaseName, err);
		throw err;
	}
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
): Promise<{ state: StreamState; metadata: StreamResultMetadata }> {
	if (!providerConfig) {
		throw new Error(`No provider configured for ${phaseName}. Please set one in Settings.`);
	}

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
				}
			: undefined,
	});

	const metadata = await accumulator.resultMetadata;
	return { state: accumulator.state, metadata };
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

function buildSummarizerMessages(input: PipelineInput, actSummaryHeading: string) {
	const { previousNarrativeVariables, actSummary, completedScenes } = input;
	const sceneTitle = previousNarrativeVariables?.sceneTitle ?? '';

	if (previousNarrativeVariables && previousNarrativeVariables.narrativeBody) {
		return toUserMessages([
			actSummaryHeading + actSummary,
			SECTION.PREVIOUS_NARRATIVE_BODY + previousNarrativeVariables.narrativeBody,
			...playerResponseSection(input.player),
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
	const { completedScenes, execution } = input;
	const { providerConfigs, abortSignal } = execution;

	// === FIRST SUMMARY: Full generation (existing behavior) ===
	const processedTemplate = actSummaryTemplate.replaceAll('{completedScenes}', String(completedScenes));
	const summarizerSystemPrompt = summarizerPrompt.replaceAll('{actSummaryTemplate}', processedTemplate);

	const summarizerMessages = buildSummarizerMessages(input, SECTION.PREVIOUS_ACT_SUMMARY);

	return await runNonStreamingPhase('SUMMARIZER', summarizerSystemPrompt, summarizerMessages, providerConfigs.summarizer, abortSignal);
}

async function generateIncrementalSummary(input: PipelineInput, loadedPrompts: LoadedPrompts) {
	const { actSummaryIncrementalTemplate, summarizerIncrementalPrompt } = loadedPrompts;
	const { actSummary, completedScenes, previousNarrativeVariables, execution } = input;
	const { providerConfigs, abortSignal } = execution;

	// === INCREMENTAL UPDATE: Parse, merge, serialize ===
	const sceneNumber = String(completedScenes);
	const sceneTitle = previousNarrativeVariables?.sceneTitle ?? '';
	const processedTemplate = actSummaryIncrementalTemplate
		.replaceAll('{completedScenes}', String(completedScenes))
		.replaceAll('{sceneNumber}', sceneNumber)
		.replaceAll('{sceneTitle}', sceneTitle);

	const incrementalSystemPrompt = summarizerIncrementalPrompt.replaceAll('{actSummaryTemplate}', processedTemplate);

	const incrementalMessages = buildSummarizerMessages(input, SECTION.EXISTING_ACT_SUMMARY);
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
}

/**
 * Returns the generated scene plot text.
 */
async function runPlotPlanner(input: PipelineInput, loadedPrompts: LoadedPrompts, effectiveTargetWordCount: string): Promise<string> {
	const { worldContent, actPlot, actSummary, execution } = input;
	const { providerConfigs, abortSignal, tools } = execution;
	const playerResponse = input.player?.playerResponse;
	const { plotPlannerSystemPrompt, generalInstructions } = loadedPrompts;

	const systemPrompt = plotPlannerSystemPrompt
		.replaceAll('{generalInstructions}', generalInstructions)
		.replaceAll('{targetWordCount}', effectiveTargetWordCount);

	const messages = toUserMessages([
		SECTION.WORLD_CONTENT + worldContent,
		SECTION.ACT_PLOT + actPlot,
		SECTION.ACT_SUMMARY + actSummary,
		...(playerResponse ? [SECTION.PLAYER_RESPONSE + playerResponse] : []),
		plotPlannerExtractionPrompt,
	]);

	return await runNonStreamingPhase(
		'PLOT_PLANNER',
		systemPrompt,
		messages,
		providerConfigs.plotPlanner,
		abortSignal,
		filterToolsForPhase(tools, 'PLOT_PLANNER')
	);
}

/**
 * Run the full narrative generation pipeline.
 *
 * Sequential phases (Writer → Reviewer → Editor → Game Master) run in order.
 * Async phases (Summarizer + Plot Planner in parallel, then Memory Extraction)
 * run concurrently with the sequential chain and resolve afterward.
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

	const defaultTargetWordCount = 400; // TODO: make this configurable in settings
	const effectiveTargetWordCount = String(targetWordCount ?? defaultTargetWordCount);

	const previousNarrativeBody = previousNarrativeVariables?.narrativeBody;

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
	} = loadedPrompts;

	// --- Async phases (Summarizer + Plot Planner parallel, then Memory) ---
	const asyncPhases = (async (): Promise<AsyncPhaseResults> => {
		if (player?.playerResponse && completedScenes > 0) {
			// Summarizer + Plot Planner run in parallel
			const [newActSummary, plotResult] = await Promise.all([
				actSummary ? generateIncrementalSummary(input, loadedPrompts) : generateFullSummary(input, loadedPrompts),
				runPlotPlanner(input, loadedPrompts, effectiveTargetWordCount),
			]);

			// Memory extraction depends on Summarizer result
			const playerMessageId = player.playerMessageId;
			if (previousNarrativeBody && actLineId && playerMessageId && storyId) {
				try {
					await runMemoryExtractionPipeline(previousNarrativeBody, storyId, actLineId, playerMessageId, newActSummary);
				} catch (err) {
					await log.error('memory-pipeline', 'Memory extraction failed', err);
				}
			}

			return { actSummary: newActSummary, scenePlot: plotResult };
		} else {
			// No player response — only run Plot Planner
			const plotResult = await runPlotPlanner(input, loadedPrompts, effectiveTargetWordCount);
			return { scenePlot: plotResult };
		}
	})();

	// --- Sequential Phase 1: Writer ---
	{
		const result = await executeStreamingPhase(
			{
				phaseName: 'WRITER',
				systemPrompt: writerSystemPrompt
					.replaceAll('{generalInstructions}', generalInstructions)
					.replaceAll('{targetWordCount}', effectiveTargetWordCount),
				...sharedParams,
				tools: filterToolsForPhase(tools, 'WRITER'),
				descriptors: NARRATIVE_DESCRIPTORS,
				messages: toUserMessages([
					SECTION.WRITER_OUTPUT_TEMPLATE + writerOutputTemplate,
					SECTION.WORLD_CONTENT + worldContent,
					SECTION.ACT_PLOT + actPlot,
					SECTION.ACT_SUMMARY + actSummary,
					...(previousScenePlot ? [SECTION.SCENE_PLOT + previousScenePlot] : []),
					...(previousNarrativeBody ? [SECTION.PREVIOUS_NARRATIVE_BODY + previousNarrativeBody] : []),
					...playerResponseSection(player),
					writerExtractionPrompt,
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
					...(previousNarrativeBody ? [SECTION.PREVIOUS_NARRATIVE_BODY + previousNarrativeBody] : []),
					...playerResponseSection(player),
					...(state.writerOutput ? [SECTION.WRITER_OUTPUT + state.writerOutput] : []),
					reviewerExtractionPrompt,
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
						.replaceAll('{targetWordCount}', effectiveTargetWordCount),
					...sharedParams,
					tools: filterToolsForPhase(tools, 'EDITOR'),
					descriptors: EDITOR_DESCRIPTORS,
					messages: toUserMessages([
						SECTION.WRITER_OUTPUT_TEMPLATE + writerOutputTemplate,
						SECTION.WORLD_CONTENT + worldContent,
						SECTION.ACT_PLOT + actPlot,
						SECTION.ACT_SUMMARY + actSummary,
						...(previousScenePlot ? [SECTION.SCENE_PLOT + previousScenePlot] : []),
						...(previousNarrativeBody ? [SECTION.PREVIOUS_NARRATIVE_BODY + previousNarrativeBody] : []),
						...playerResponseSection(player),
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

	// --- Sequential Phase 4: Game Master ---
	{
		const result = await executeStreamingPhase(
			{
				phaseName: 'GAME_MASTER',
				systemPrompt: gameMasterSystemPrompt,
				...sharedParams,
				tools: filterToolsForPhase(tools, 'GAME_MASTER'),
				descriptors: GAME_MASTER_DESCRIPTORS,
				messages: toUserMessages([
					SECTION.ACT_PLOT + actPlot,
					SECTION.ACT_SUMMARY + actSummary,
					...(previousScenePlot ? [SECTION.SCENE_PLOT + previousScenePlot] : []),
					...(previousNarrativeBody ? [SECTION.PREVIOUS_NARRATIVE_BODY + previousNarrativeBody] : []),
					...playerResponseSection(player),
					...(state.editorOutput ? [SECTION.EDITOR_OUTPUT + state.editorOutput] : []),
					gameMasterExtractionPrompt,
				]),
				providerConfig: providerConfigs.gameMaster,
				buildStateUpdate: (ss) => ({
					gameMasterOutput: ss.content,
					gameData: ss.variables?.gameData ?? null,
				}),
			},
			state
		);
		state = result.state;
	}

	state = updateState(state, { currentPhase: null });
	callbacks.onAllComplete(state);
	return { state, editorMetadata, asyncPhases };
}
