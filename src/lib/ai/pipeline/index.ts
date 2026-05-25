import { isQuickReview } from '$lib/stores/settings.svelte';
import { ls } from '$lib/localization';
import type { ActPhase, EndingType } from '../narrative-types';
import { DEFAULT_RETRY_CONFIG, type PhaseMetadata, toPhaseMetadata } from '../chat-stream';
import {
	type CommonPipelineInput,
	type PipelineInput,
	type PipelineProviderConfigs,
	type PipelineResult,
	type PipelineState,
	type PlayerContext,
	type PostEditorContext,
	type PreEditorContext,
	type PreEditorContextFactory,
} from './types';
import { aggregateMetadata } from './phase-executor';
import { type StreamResultMetadata } from '../streaming';
import {
	defaultTargetWordCount,
	ENDING_LABELS,
	maybeExtractImportantPhrases,
	type PipelinePrompts,
	type PipelineRunContext,
	runEditorTemplateFitter,
	runGamePhases,
	runGmTemplateFitter,
	runReviewerEditorPhases,
	runWriterPhase,
	type TrackPhase,
} from './runners';
import type { LoadedPrompts } from './prompt-loader';
import { loadPrompts } from './prompt-loader';
import { runAsyncPhases } from './summarizer';
import { buildPipelineProviderConfigs } from '$lib/ai/chat/pipeline-config';
import { buildTools } from '$lib/ai/tools/tools';
import { AbstractPreEditorContext } from '$lib/ai/pipeline/message-builder';

class MainPreEditorContext extends AbstractPreEditorContext {
	previousScenePlot: string | undefined;
	player: PlayerContext | undefined;
	constructor(input: PipelineInput) {
		super(input);
		this.previousScenePlot = input.previousScenePlot;
		this.player = input.player;
	}
}

class EpiloguePreEditorContext extends AbstractPreEditorContext {
	actPhase: ActPhase | null = null;
	previousScenePlot: string | undefined = undefined;
	player: PlayerContext | undefined = undefined;
	constructor(input: CommonPipelineInput) {
		super(input);
	}
}

export interface EpiloguePipelineInput extends CommonPipelineInput {
	endingType: EndingType;
}

function preparePipelinePrompts(loadedPrompts: LoadedPrompts) {
	const reviewerPrompt = isQuickReview() ? loadedPrompts.quickReviewerSystemPromptTemplate : loadedPrompts.reviewerSystemPromptTemplate;
	const prompts: PipelinePrompts = {
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
	};
	return prompts;
}

async function buildPipelineContext(
	input: CommonPipelineInput,
	loadedPrompts: LoadedPrompts,
	providerConfigs: PipelineProviderConfigs,
	preEditorContextClass: PreEditorContextFactory
): Promise<PipelineRunContext> {
	const { execution, story, assistant, completedScenes, targetWordCount } = input;
	const { abortSignal, callbacks } = execution;

	const effectiveTargetWordCount = String(targetWordCount ?? defaultTargetWordCount);
	const currentScene = completedScenes > 0 ? String(completedScenes + 1) : '1';
	const retryConfig = input.retryConfig ?? DEFAULT_RETRY_CONFIG;
	const sharedParams = { abortSignal, callbacks, retryConfig };

	const preEditorCtx: PreEditorContext = new preEditorContextClass(input);

	const tools = await buildTools(story.storyId, story.actLine, assistant);
	const prompts = preparePipelinePrompts(loadedPrompts);

	return {
		sharedParams,
		providerConfigs,
		preEditorCtx,
		prompts,
		effectiveTargetWordCount,
		currentScene,
		tools,
		story,
		assistant,
	};
}

function buildTrackPhase() {
	let aggregatedMetadata: StreamResultMetadata | null = null;
	const phaseEntries: PhaseMetadata[] = [];

	const trackPhase: TrackPhase = (phaseName, result, model) => {
		aggregatedMetadata = aggregateMetadata(aggregatedMetadata, result.metadata, model);
		phaseEntries.push(toPhaseMetadata(phaseName, result.metadata, model));
		return result.state;
	};

	return {
		trackPhase,
		getAggregatedMetadata: () => aggregatedMetadata ?? undefined,
		getPhaseEntries: () => (phaseEntries.length > 0 ? phaseEntries : undefined),
	};
}

function finalizePipelineResult(state: PipelineState, tracker: ReturnType<typeof buildTrackPhase>): PipelineResult {
	return {
		state,
		aggregatedMetadata: tracker.getAggregatedMetadata(),
		phases: tracker.getPhaseEntries(),
	};
}

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
	const { previousScenePlot, player, previousNarrativeVariables, story, completedScenes, directorNotes, execution } = input;
	const previousNarrativeBody = previousNarrativeVariables?.narrativeBody ?? undefined;
	const previousTurnOfEvents = previousNarrativeVariables?.turnOfEvents ?? undefined;

	const loadedPrompts: LoadedPrompts = await loadPrompts(story.storyId, story.storyName);
	const providerConfigs: PipelineProviderConfigs = buildPipelineProviderConfigs();
	const ctx = await buildPipelineContext(input, loadedPrompts, providerConfigs, MainPreEditorContext);

	const { callbacks } = execution;
	const tracker = buildTrackPhase();

	// --- Async phases (Summarizer → Character Profile Compressor → Memory) ---
	const asyncPhases = runAsyncPhases({
		player,
		completedScenes,
		actSummary: input.actSummary,
		previousNarrativeVariables,
		previousNarrativeBody,
		providerConfigs,
		abortSignal: execution.abortSignal,
		storyId: story.storyId,
		actLineId: story.actLine.id,
		loadedPrompts,
	});

	// --- Sequential phases ---
	let state: PipelineState = {};
	state = await runWriterPhase(ctx, state, tracker.trackPhase);
	state = await runReviewerEditorPhases(ctx, state, tracker.trackPhase);
	state = await runEditorTemplateFitter(ctx, state, tracker.trackPhase);
	maybeExtractImportantPhrases(state, callbacks);

	const postEditorCtx: PostEditorContext = {
		actPlot: input.actPlot,
		actPhase: story.actLine.currentActPhase,
		actSummary: input.actSummary,
		previousScenePlot,
		previousNarrativeBody,
		completedScenes,
		player,
		previousTurnOfEvents,
		editorOutput: state.editorOutput,
		directorNotes,
	};
	state = await runGamePhases(ctx, state, postEditorCtx, tracker.trackPhase);
	state = await runGmTemplateFitter(ctx, state, tracker.trackPhase);

	const result = finalizePipelineResult(state, tracker);
	callbacks.onAllComplete(state);
	return { ...result, asyncPhases };
}

export async function runEpiloguePipeline(input: EpiloguePipelineInput): Promise<PipelineResult> {
	const { endingType, execution, story } = input;
	const { callbacks } = execution;

	const loadedPrompts: LoadedPrompts = await loadPrompts(story.storyId, story.storyName);
	const providerConfigs: PipelineProviderConfigs = buildPipelineProviderConfigs();
	const ctx = await buildPipelineContext(input, loadedPrompts, providerConfigs, EpiloguePreEditorContext);

	const tracker = buildTrackPhase();
	const epilogueExtractionPrompt = ls('pipeline.extraction.writer.epilogue', { endingType: ENDING_LABELS[endingType] });

	let state: PipelineState = {};
	state = await runWriterPhase(ctx, state, tracker.trackPhase, epilogueExtractionPrompt);
	state = await runReviewerEditorPhases(ctx, state, tracker.trackPhase);
	state = await runEditorTemplateFitter(ctx, state, tracker.trackPhase);
	maybeExtractImportantPhrases(state, callbacks);

	const result = finalizePipelineResult(state, tracker);
	callbacks.onAllComplete(state);
	return result;
}
