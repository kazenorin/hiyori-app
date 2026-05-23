import { getDefaultPlotMode, getReevaluationFrequency, isQuickReview } from '$lib/stores/settings.svelte';
import type { NarrativeVariables } from '../narrative-types';
import type { EndingType } from '../narrative-types';
import { DEFAULT_RETRY_CONFIG, type PhaseMetadata, type RetryConfig, toPhaseMetadata } from '../chat-stream';
import type { PipelineExecution, PipelineInput, PipelineResult, PipelineState, StoryContext } from './types';
import { aggregateMetadata, updateState } from './phase-executor';
import { type StreamResultMetadata } from '../streaming';
import { type PreEditorContext, type PostEditorContext } from './message-builder';
import {
	defaultTargetWordCount,
	runEditorTemplateFitter,
	runEpilogueWriterPhase,
	runGamePhases,
	runGmTemplateFitter,
	runReviewerEditorPhases,
	runWriterPhase,
	maybeExtractImportantPhrases,
	type PipelineRunContext,
	type TrackPhase,
} from './runners';
import { loadPrompts } from './prompt-loader';
import { runAsyncPhases } from './summarizer';
import { buildPipelineProviderConfigs } from '$lib/ai/chat/pipeline-config';
import { buildTools } from '$lib/ai/tools/tools';

/**
 * Run the full narrative generation pipeline.
 * Sequential phases: Writer → Reviewer → Editor → [Game Master ‖ Plot Planner].
 * Game Master and Plot Planner run concurrently after Editor completes.
 * Async phases (Summarizer, then Memory Extraction) run concurrently with the
 * sequential chain and resolve afterward.
 * Editor LLM call is skipped when the reviewer indicates "accept as-is".
 * Context is passed as user messages, not stuffed into the system prompt.
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
	const providerConfigs = buildPipelineProviderConfigs();
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
	const { abortSignal, callbacks } = execution;
	const storyId = story.storyId;
	const storyName = story.storyName;
	const actLineId = story.actLine.id;
	const actPhase = story.actLine.actPhase;
	const lastPlotGeneration = story.actLine.lastPlotGeneration;
	const plotMode = story.actLine.plotMode ?? getDefaultPlotMode();
	const effectiveTargetWordCount = String(targetWordCount ?? defaultTargetWordCount);
	const currentScene = completedScenes > 0 ? String(completedScenes + 1) : '1';
	const previousNarrativeBody = previousNarrativeVariables?.narrativeBody;
	const previousTurnOfEvents = previousNarrativeVariables?.turnOfEvents;
	const retryConfig = input.retryConfig ?? DEFAULT_RETRY_CONFIG;
	const sharedParams = { abortSignal, callbacks, retryConfig };

	const preEditorCtx: PreEditorContext = {
		worldContent,
		actPlot,
		actPhase,
		actSummary,
		previousScenePlot,
		previousNarrativeBody: previousNarrativeBody ?? undefined,
		completedScenes,
		player,
		previousTurnOfEvents: previousTurnOfEvents ?? undefined,
		directorNotes,
	};

	let state: PipelineState = { currentPhase: null };
	let aggregatedMetadata: StreamResultMetadata | null = null;
	const phaseEntries: PhaseMetadata[] = [];

	const tools = await buildTools(storyId, story.actLine);
	const loadedPrompts = await loadPrompts(storyId, storyName);
	const reviewerPrompt = isQuickReview() ? loadedPrompts.quickReviewerSystemPromptTemplate : loadedPrompts.reviewerSystemPromptTemplate;

	const ctx: PipelineRunContext = {
		sharedParams,
		providerConfigs,
		preEditorCtx,
		prompts: {
			generalInstructions: loadedPrompts.generalInstructions,
			writerOutputTemplate: loadedPrompts.writerOutputTemplate,
			reviewerPrompt,
			writerSystemPrompt: loadedPrompts.writerSystemPrompt,
			editorSystemPrompt: loadedPrompts.editorSystemPrompt,
			gameMasterSystemPrompt: loadedPrompts.gameMasterSystemPrompt,
			plotPlannerSystemPrompt: loadedPrompts.plotPlannerSystemPrompt,
			phaseEventPlotPlannerSystemPrompt: loadedPrompts.phaseEventPlotPlannerSystemPrompt,
			guidanceWriterExtractionPrompt: loadedPrompts.guidanceWriterExtractionPrompt,
			phaseEventWriterExtractionPrompt: loadedPrompts.phaseEventWriterExtractionPrompt,
		},
		effectiveTargetWordCount,
		currentScene,
		tools,
		plotMode,
		actPhase,
		lastPlotGeneration,
		reevaluationFrequency: getReevaluationFrequency(),
	};

	const trackPhase: TrackPhase = (phaseName, result, model) => {
		aggregatedMetadata = aggregateMetadata(aggregatedMetadata, result.metadata, model);
		phaseEntries.push(toPhaseMetadata(phaseName, result.metadata, model));
		return result.state;
	};

	// --- Async phases (Summarizer → Character Profile Compressor → Memory) ---
	const asyncPhases = runAsyncPhases({
		player,
		completedScenes,
		actSummary,
		previousNarrativeVariables,
		previousNarrativeBody: previousNarrativeBody ?? undefined,
		providerConfigs,
		abortSignal,
		storyId,
		actLineId,
		loadedPrompts,
	});

	// --- Sequential phases ---
	state = await runWriterPhase(ctx, state, trackPhase);
	state = await runReviewerEditorPhases(ctx, state, trackPhase);
	state = await runEditorTemplateFitter(ctx, state, trackPhase);
	maybeExtractImportantPhrases(state, callbacks);

	const postEditorCtx: PostEditorContext = {
		actPlot,
		actPhase,
		actSummary,
		previousScenePlot,
		previousNarrativeBody: previousNarrativeBody ?? undefined,
		completedScenes,
		player,
		previousTurnOfEvents: previousTurnOfEvents ?? undefined,
		editorOutput: state.editorOutput ?? '',
		directorNotes,
	};
	state = await runGamePhases(ctx, state, postEditorCtx, trackPhase);
	state = await runGmTemplateFitter(ctx, state, trackPhase);

	state = updateState(state, { currentPhase: null });
	callbacks.onAllComplete(state);
	return {
		state,
		aggregatedMetadata: aggregatedMetadata ?? undefined,
		phases: phaseEntries.length > 0 ? phaseEntries : undefined,
		asyncPhases,
	};
}

export interface EpiloguePipelineInput {
	execution: PipelineExecution;
	worldContent: string;
	actPlot: string;
	actSummary: string;
	previousNarrativeVariables: NarrativeVariables | undefined;
	endingType: EndingType;
	story: StoryContext;
	completedScenes: number;
	targetWordCount?: number;
	retryConfig?: RetryConfig;
}

export async function runEpiloguePipeline(input: EpiloguePipelineInput): Promise<PipelineResult> {
	const providerConfigs = buildPipelineProviderConfigs();
	const { execution, worldContent, actPlot, actSummary, previousNarrativeVariables, endingType, story, completedScenes, targetWordCount } =
		input;
	const { abortSignal, callbacks } = execution;
	const effectiveTargetWordCount = String(targetWordCount ?? defaultTargetWordCount);
	const currentScene = String(completedScenes + 1);
	const previousNarrativeBody = previousNarrativeVariables?.narrativeBody;
	const retryConfig = input.retryConfig ?? DEFAULT_RETRY_CONFIG;
	const sharedParams = { abortSignal, callbacks, retryConfig };

	const preEditorCtx: PreEditorContext = {
		worldContent,
		actPlot,
		actPhase: null,
		actSummary,
		previousScenePlot: undefined,
		previousNarrativeBody: previousNarrativeBody ?? undefined,
		completedScenes,
		player: undefined,
		previousTurnOfEvents: undefined,
		directorNotes: '',
	};

	let state: PipelineState = { currentPhase: null };
	let aggregatedMetadata: StreamResultMetadata | null = null;
	const phaseEntries: PhaseMetadata[] = [];

	const loadedPrompts = await loadPrompts(story.storyId, story.storyName);

	const ctx: PipelineRunContext = {
		sharedParams,
		providerConfigs,
		preEditorCtx,
		prompts: {
			generalInstructions: loadedPrompts.generalInstructions,
			writerOutputTemplate: loadedPrompts.writerOutputTemplate,
			reviewerPrompt: '',
			writerSystemPrompt: loadedPrompts.writerSystemPrompt,
			editorSystemPrompt: '',
			gameMasterSystemPrompt: '',
			plotPlannerSystemPrompt: '',
			phaseEventPlotPlannerSystemPrompt: '',
			guidanceWriterExtractionPrompt: '',
			phaseEventWriterExtractionPrompt: '',
		},
		effectiveTargetWordCount,
		currentScene,
		tools: undefined,
		plotMode: 'guidance',
		actPhase: null,
		lastPlotGeneration: null,
		reevaluationFrequency: 0,
	};

	const trackPhase: TrackPhase = (phaseName, result, model) => {
		aggregatedMetadata = aggregateMetadata(aggregatedMetadata, result.metadata, model);
		phaseEntries.push(toPhaseMetadata(phaseName, result.metadata, model));
		return result.state;
	};

	state = await runEpilogueWriterPhase(ctx, state, trackPhase, endingType);

	state = updateState(state, { currentPhase: null });
	callbacks.onAllComplete(state);
	return {
		state,
		aggregatedMetadata: aggregatedMetadata ?? undefined,
		phases: phaseEntries.length > 0 ? phaseEntries : undefined,
	};
}
