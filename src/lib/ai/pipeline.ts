import type { ToolSet } from 'ai';
import { generateText } from 'ai';
import type { MessageBase } from '$lib/db/messages';
import type { ProviderConfig } from '$lib/stores/settings.svelte';
import { streamChatResponse } from './chat-stream';
import { createModel } from './provider';
import type { NarrativeVariables, PhaseName } from './narrative-types';
import type { PipelineCallbacks, PipelineState } from './pipeline-types';
import type { StreamState } from './chat-callbacks';
import type { StreamResultMetadata } from './streaming';
import { variablesToMarkdown } from './template-renderer';
import { runMemoryExtractionPipeline } from './memory-extraction-pipeline';
import { log } from '$lib/logging/logger';
import {
	loadActSummaryTemplate,
	loadEditorPrompt,
	loadGameMasterPrompt,
	loadGeneralInstructions,
	loadPlotPlannerPrompt,
	loadReviewerPrompt,
	loadStoryActSummaryTemplate,
	loadStoryEditorPrompt,
	loadStoryGameMasterPrompt,
	loadStoryGeneralInstructions,
	loadStoryPlotPlannerPrompt,
	loadStoryReviewerPrompt,
	loadStorySummarizerPrompt,
	loadStoryWriterOutputTemplate,
	loadStoryWriterPrompt,
	loadSummarizerPrompt,
	loadWriterOutputTemplate,
	loadWriterPrompt,
} from '$lib/fs/prompts';

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
};

/**
 * Reconstruct full output text from a StreamState.
 * The SaxSectionParser routes structured sections (Scene Title, Background,
 * Narrative Body, CG) into `variables` and leaves unhandled text in `content`.
 * For phases that output the writer template format, we need to combine both
 * to get the complete output.
 */
function fullOutput(ss: StreamState): string {
	if (ss.variables && (ss.variables.sceneTitle || ss.variables.narrativeBody)) {
		const parts: string[] = [];
		if (ss.content) parts.push(ss.content);
		parts.push(variablesToMarkdown(ss.variables));
		return parts.join('\n');
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
	player?: PlayerContext;
	story?: StoryContext;
	completedScenes?: number;
	targetWordCount?: number;
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
	const { phaseName, systemPrompt, messages, providerConfig, abortSignal, tools, callbacks, buildStateUpdate } = params;
	state = updateState(state, { currentPhase: phaseName });
	callbacks.onPhaseStart(phaseName);
	try {
		const result = await runStreamingPhase(phaseName, systemPrompt, messages, providerConfig, abortSignal, tools, callbacks);
		state = updateState(state, buildStateUpdate(result.state));
		callbacks.onPhaseComplete(phaseName, state);
		return { state, streamState: result.state, metadata: result.metadata };
	} catch (err: unknown) {
		callbacks.onError(phaseName, err);
		throw err;
	}
}

/**
 * Run a single streaming phase and return the accumulated stream state.
 */
async function runStreamingPhase(
	phaseName: PhaseName,
	systemPrompt: string,
	messages: MessageBase[],
	providerConfig: ProviderConfig | undefined,
	abortSignal: AbortSignal,
	tools: ToolSet | undefined,
	callbacks: PipelineCallbacks
): Promise<{ state: StreamState; metadata: StreamResultMetadata }> {
	if (!providerConfig) {
		throw new Error(`No provider configured for ${phaseName}. Please set one in Settings.`);
	}

	const accumulator = await streamChatResponse(
		systemPrompt,
		messages,
		abortSignal,
		(streamState: StreamState) => {
			callbacks.onPhaseStream(phaseName, streamState);
		},
		(err: unknown) => {
			throw err instanceof Error ? err : new Error(String(err));
		},
		providerConfig,
		tools
	);

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
	abortSignal: AbortSignal
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
	});

	return result.text;
}

/**
 * Convert an array of content strings into user messages.
 */
function toUserMessages(contents: string[]): MessageBase[] {
	return contents.map((content) => ({ role: 'user' as const, content }));
}

/**
 * Run the full narrative generation pipeline.
 *
 * Phase 0 (Summarizer) runs first if playerResponse is defined, producing an updated
 * act summary from the previous scene's narrative body and the player's decision.
 * Phases 1-4 run sequentially (Plot Planner -> Writer -> Reviewer -> Editor).
 * Phase 5 (Game Master) runs last, producing game data from the edited output.
 * Context is passed as user messages, not stuffed into the system prompt.
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineState & { editorMetadata?: StreamResultMetadata }> {
	const { execution, worldContent, actPlot, actSummary, previousNarrativeVariables, player, story, completedScenes, targetWordCount } =
		input;

	const { providerConfigs, abortSignal, tools, callbacks } = execution;

	const storyId = story?.storyId;
	const storyName = story?.storyName;
	const actLineId = story?.actLineId;
	const playerResponse = player?.playerResponse;
	const playerMessageId = player?.playerMessageId;

	const defaultTargetWordCount = 400;
	const effectiveTargetWordCount = String(targetWordCount ?? defaultTargetWordCount);
	const effectivePlayerResponse = playerResponse ?? '(no response)';

	const sharedParams = {
		abortSignal,
		tools,
		callbacks,
	};

	let state: PipelineState = { currentPhase: null };
	let editorMetadata: StreamResultMetadata | undefined;

	// Load prompts — story-specific if storyId is provided, global otherwise
	const [
		plotPlannerPrompt,
		generalInstructions,
		writerPrompt,
		writerTemplate,
		reviewerPrompt,
		editorPrompt,
		gameMasterPrompt,
		summarizerPrompt,
		summaryTemplate,
	] = await Promise.all(
		storyId && storyName
			? [
					loadStoryGeneralInstructions(storyId, storyName),
					loadStoryPlotPlannerPrompt(storyId, storyName),
					loadStoryWriterPrompt(storyId, storyName),
					loadStoryWriterOutputTemplate(storyId, storyName),
					loadStoryReviewerPrompt(storyId, storyName),
					loadStoryEditorPrompt(storyId, storyName),
					loadStoryGameMasterPrompt(storyId, storyName),
					loadStorySummarizerPrompt(storyId, storyName),
					loadStoryActSummaryTemplate(storyId, storyName),
				]
			: [
					loadGeneralInstructions(),
					loadPlotPlannerPrompt(),
					loadWriterPrompt(),
					loadWriterOutputTemplate(),
					loadReviewerPrompt(),
					loadEditorPrompt(),
					loadGameMasterPrompt(),
					loadSummarizerPrompt(),
					loadActSummaryTemplate(),
				]
	);

	let newActSummary = actSummary;

	// --- Phase 0: Summarizer (only when player has responded) ---
	if (playerResponse) {
		callbacks.onPhaseStart('SUMMARIZER');
		let processedTemplate = summaryTemplate;

		// Inject programmatic completed scenes count
		if (completedScenes != null) {
			processedTemplate = processedTemplate.replaceAll('{completedScenes}', String(completedScenes));
		}

		const summarizerSystem = summarizerPrompt.replaceAll('{actSummaryTemplate}', processedTemplate);

		let summarizerMessages: MessageBase[];
		if (previousNarrativeVariables && previousNarrativeVariables.narrativeBody) {
			summarizerMessages = toUserMessages([
				SECTION.PREVIOUS_ACT_SUMMARY + actSummary,
				SECTION.PREVIOUS_NARRATIVE_BODY + previousNarrativeVariables.narrativeBody,
				SECTION.PLAYER_RESPONSE + effectivePlayerResponse,
				`Update the Act Summary adding information for the previous scene: "Scene ${completedScenes}: ${previousNarrativeVariables.sceneTitle ?? 'Untitled'}"`,
			]);
		} else {
			summarizerMessages = toUserMessages([
				SECTION.PREVIOUS_ACT_SUMMARY + actSummary,
				SECTION.PLAYER_RESPONSE + effectivePlayerResponse,
				`Update the Act Summary for Scene ${completedScenes ?? 1} based on the Player Response.`,
			]);
		}

		newActSummary = await runNonStreamingPhase('SUMMARIZER', summarizerSystem, summarizerMessages, providerConfigs.summarizer, abortSignal);
		state = updateState(state, { actSummary: newActSummary });
		callbacks.onPhaseComplete('SUMMARIZER', state);

		// Run memory extraction after summary is available (must complete before Phase 1
		// because Plot Planner queries memories via tools)
		if (previousNarrativeVariables?.narrativeBody && actLineId && playerMessageId && storyId) {
			try {
				await runMemoryExtractionPipeline(previousNarrativeVariables.narrativeBody, storyId, actLineId, playerMessageId, newActSummary);
			} catch (err) {
				log.error('memory-pipeline', 'Memory extraction failed', err);
			}
		}
	}
	// --- Phase 1: Plot Planner ---
	{
		const result = await executeStreamingPhase(
			{
				phaseName: 'PLOT_PLANNER',
				systemPrompt: plotPlannerPrompt
					.replaceAll('{generalInstructions}', generalInstructions)
					.replaceAll('{targetWordCount}', effectiveTargetWordCount),
				...sharedParams,
				messages: toUserMessages([
					SECTION.WORLD_CONTENT + worldContent,
					SECTION.ACT_PLOT + actPlot,
					SECTION.ACT_SUMMARY + newActSummary,
					SECTION.PLAYER_RESPONSE + effectivePlayerResponse,
					'Generate a Scene Plot based on the available information in the chat history.',
				]),
				providerConfig: providerConfigs.plotPlanner,
				buildStateUpdate: (ss) => ({ scenePlot: ss.content }),
			},
			state
		);
		state = result.state;
	}

	// --- Phase 2: Writer ---
	{
		const result = await executeStreamingPhase(
			{
				phaseName: 'WRITER',
				systemPrompt: writerPrompt
					.replaceAll('{generalInstructions}', generalInstructions)
					.replaceAll('{targetWordCount}', effectiveTargetWordCount),
				...sharedParams,
				messages: toUserMessages([
					SECTION.WRITER_OUTPUT_TEMPLATE + writerTemplate,
					SECTION.WORLD_CONTENT + worldContent,
					SECTION.ACT_PLOT + actPlot,
					SECTION.ACT_SUMMARY + newActSummary,
					SECTION.SCENE_PLOT + (state.scenePlot ?? ''),
					SECTION.PLAYER_RESPONSE + effectivePlayerResponse,
					'Write a story prose based on the available information in the chat history.',
				]),
				providerConfig: providerConfigs.writer,
				buildStateUpdate: (ss) => ({ writerOutput: fullOutput(ss) }),
			},
			state
		);
		state = result.state;
	}

	// --- Phase 3: Reviewer ---
	{
		const result = await executeStreamingPhase(
			{
				phaseName: 'REVIEWER',
				systemPrompt: reviewerPrompt.replaceAll('{generalInstructions}', generalInstructions),
				...sharedParams,
				messages: toUserMessages([
					SECTION.WORLD_CONTENT + worldContent,
					SECTION.ACT_PLOT + actPlot,
					SECTION.ACT_SUMMARY + newActSummary,
					SECTION.SCENE_PLOT + (state.scenePlot ?? ''),
					SECTION.PLAYER_RESPONSE + effectivePlayerResponse,
					SECTION.WRITER_OUTPUT + (state.writerOutput ?? ''),
					"Perform a review on the writer's output based on the available information in the chat history.",
				]),
				providerConfig: providerConfigs.reviewer,
				buildStateUpdate: (ss) => ({ reviewerOutput: ss.content }),
			},
			state
		);
		state = result.state;
	}

	// --- Phase 4: Editor ---
	{
		const result = await executeStreamingPhase(
			{
				phaseName: 'EDITOR',
				systemPrompt: editorPrompt
					.replaceAll('{generalInstructions}', generalInstructions)
					.replaceAll('{targetWordCount}', effectiveTargetWordCount),
				...sharedParams,
				messages: toUserMessages([
					SECTION.WRITER_OUTPUT_TEMPLATE + writerTemplate,
					SECTION.WORLD_CONTENT + worldContent,
					SECTION.ACT_PLOT + actPlot,
					SECTION.ACT_SUMMARY + newActSummary,
					SECTION.SCENE_PLOT + (state.scenePlot ?? ''),
					SECTION.PLAYER_RESPONSE + effectivePlayerResponse,
					SECTION.WRITER_OUTPUT + (state.writerOutput ?? ''),
					SECTION.REVIEWER_OUTPUT + (state.reviewerOutput ?? ''),
					'Apply suggestions from the reviewer output to the writer output. Judge whether the suggestions are necessary based on the available information in the chat history.',
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

	// --- Phase 5: Game Master ---
	{
		const result = await executeStreamingPhase(
			{
				phaseName: 'GAME_MASTER',
				systemPrompt: gameMasterPrompt,
				...sharedParams,
				messages: toUserMessages([
					SECTION.ACT_PLOT + actPlot,
					SECTION.ACT_SUMMARY + newActSummary,
					SECTION.SCENE_PLOT + (state.scenePlot ?? ''),
					SECTION.PLAYER_RESPONSE + effectivePlayerResponse,
					SECTION.EDITOR_OUTPUT + (state.editorOutput ?? ''),
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
	return { ...state, editorMetadata };
}
