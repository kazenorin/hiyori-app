import type { EndingType } from '../narrative-types';
import { DEFAULT_RETRY_CONFIG, type PhaseMetadata, toPhaseMetadata } from '../chat-stream';
import {
	type BackgroundPhaseResults,
	type CommonPipelineInput,
	type PipelineInput,
	type PipelineProviderConfigs,
	type PipelineResult,
	type PipelineState,
	type ProfileCompressionState,
} from './types';
import { aggregateMetadata, aggregateMetadataFromPhases } from './phase-executor';
import { type StreamResultMetadata } from '../streaming';
import { log } from '#lib/logging/logger.ts';
import {
	defaultTargetWordCount,
	getEndingLabel,
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
import { runBackgroundPhases } from './summarizer';
import { buildPipelineProviderConfigs, resolveParallelRunMode } from '#lib/ai/chat/pipeline-config.ts';
import { settings } from '#lib/stores/settings.svelte.ts';
import { buildTools } from '#lib/ai/tools/tools.ts';
import { createNarrativeOverrides } from '#lib/ai/narrative-types.ts';

export interface EpiloguePipelineInput extends CommonPipelineInput {
	endingType: EndingType;
}

function preparePipelinePrompts(loadedPrompts: LoadedPrompts): PipelinePrompts {
	return {
		generalInstructions: loadedPrompts.generalInstructions,
		mainChatSystemPrompt: loadedPrompts.mainChatSystemPrompt,
		writerOutputTemplate: loadedPrompts.writerOutputTemplate,
		writerRole: loadedPrompts.writerRole,
		guidanceWriterExtractionPrompt: loadedPrompts.guidanceWriterExtractionPrompt,
		phaseEventWriterExtractionPrompt: loadedPrompts.phaseEventWriterExtractionPrompt,
		epilogueWriterExtractionPrompt: loadedPrompts.epilogueWriterExtractionPrompt,
		guidanceGameMasterExtractionPrompt: loadedPrompts.guidanceGameMasterExtractionPrompt,
		phaseEventGameMasterExtractionPrompt: loadedPrompts.phaseEventGameMasterExtractionPrompt,
		reviewerExtractionPrompt: loadedPrompts.reviewerExtractionPrompt,
		quickReviewerExtractionPrompt: loadedPrompts.quickReviewerExtractionPrompt,
		editorExtractionPrompt: loadedPrompts.editorExtractionPrompt,
		guidancePlotPlannerExtractionPrompt: loadedPrompts.guidancePlotPlannerExtractionPrompt,
		phaseEventPlotPlannerExtractionPrompt: loadedPrompts.phaseEventPlotPlannerExtractionPrompt,
	};
}

async function buildPipelineContext(
	input: CommonPipelineInput,
	loadedPrompts: LoadedPrompts,
	providerConfigs: PipelineProviderConfigs
): Promise<PipelineRunContext> {
	const {
		execution,
		story,
		assistant,
		completedScenes,
		targetWordCount,
		retryConfig,
		directorNotes,
		previousScenePlot,
		previousNarrativeVariables,
		context,
	} = input;
	const { abortSignal, callbacks } = execution;

	const effectiveTargetWordCount = String(targetWordCount ?? defaultTargetWordCount);
	const currentScene = completedScenes > 0 ? String(completedScenes + 1) : '1';
	const sharedParams = { abortSignal, callbacks, retryConfig: retryConfig ?? DEFAULT_RETRY_CONFIG };

	const narrativeOverrides = createNarrativeOverrides();
	const compression: ProfileCompressionState = { completedScenes, newActSummary: undefined, attemptCount: 0, successCount: 0 };
	const tools = await buildTools(story.storyId, story.actLine, assistant, narrativeOverrides, compression);
	const prompts = preparePipelinePrompts(loadedPrompts);

	return {
		sharedParams,
		providerConfigs,
		prompts,
		effectiveTargetWordCount,
		currentScene,
		completedScenes,
		directorNotes,
		previousScenePlot,
		previousTurnOfEvents: previousNarrativeVariables?.turnOfEvents ?? undefined,
		tools,
		story,
		assistant,
		narrativeOverrides,
		context,
		compression,
	};
}

/**
 * Build the phase tracker. When resuming an interrupted run, cached phase
 * entries are seeded so token stats and phase lists span both sessions.
 */
function buildTrackPhase(initialEntries?: PhaseMetadata[]) {
	let aggregatedMetadata: StreamResultMetadata | null = initialEntries?.length
		? (aggregateMetadataFromPhases(initialEntries) ?? null)
		: null;
	const phaseEntries: PhaseMetadata[] = initialEntries ? [...initialEntries] : [];

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

/**
 * Wrap the tracker's trackPhase so the phase cache is persisted after every
 * completed phase. Commit failures are logged and never fatal to the run.
 *
 * `cacheState` accumulates outputs across phases because concurrent phases
 * (Game Master ‖ Plot Planner) both start from the same base state: merging
 * each result into the accumulated cache keeps the committed snapshot whole.
 */
function buildCommittingTrackPhase(
	tracker: ReturnType<typeof buildTrackPhase>,
	initialState: PipelineState,
	onPhaseCommit: ((state: PipelineState, phases: PhaseMetadata[]) => void | Promise<void>) | undefined
): TrackPhase {
	let cacheState: PipelineState = { ...initialState };
	return async (phaseName, result, model) => {
		const newState = tracker.trackPhase(phaseName, result, model);
		cacheState = { ...cacheState, ...result.state };
		if (onPhaseCommit) {
			try {
				await onPhaseCommit(cacheState, tracker.getPhaseEntries() ?? []);
			} catch (err) {
				await log.error('pipeline', 'Failed to persist phase cache', err);
			}
		}
		return newState;
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
 * Background phases (Summarizer → Character Profile Compressor → Memory Extraction)
 * start according to the parallelRun setting: concurrently with the Writer, after
 * the Writer completes, or after the GM Template Fitter (single-threaded).
 * Editor LLM call is skipped when the reviewer indicates "accept as-is".
 * Context is passed as user messages, not stuffed into the system prompt.
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
	const { player, previousNarrativeVariables, story, completedScenes, execution } = input;
	const previousNarrativeBody = previousNarrativeVariables?.narrativeBody ?? undefined;

	const loadedPrompts: LoadedPrompts = await loadPrompts(story.storyId, story.storyName);
	const providerConfigs: PipelineProviderConfigs = buildPipelineProviderConfigs();
	const ctx = await buildPipelineContext(input, loadedPrompts, providerConfigs);
	const parallelRun = resolveParallelRunMode(settings.parallelRun, providerConfigs);

	const { callbacks } = execution;
	const tracker = buildTrackPhase(input.initialPhases);
	const trackPhase = buildCommittingTrackPhase(tracker, input.initialState ?? {}, execution.onPhaseCommit);

	// --- Background phases (Summarizer → Character Profile Compressor → Memory) ---
	const startBackgroundPhases = () =>
		runBackgroundPhases({
			player,
			completedScenes,
			actSummary: input.latestActSummary,
			previousNarrativeVariables,
			previousNarrativeBody,
			providerConfigs,
			abortSignal: execution.abortSignal,
			storyId: story.storyId,
			actLineId: story.actLine.id,
			assistant: input.assistant,
			loadedPrompts,
			context: input.context,
			tools: ctx.tools,
			compression: ctx.compression,
			callbacks,
		});

	// No shared cache to wait for: start immediately, concurrently with the Writer.
	let backgroundPhases: Promise<BackgroundPhaseResults> | undefined =
		parallelRun === 'parallelWithWriter' ? startBackgroundPhases() : undefined;

	// --- Sequential phases (resume gates: cached outputs are skipped) ---
	let state: PipelineState = { ...input.initialState };
	if (state.writerOutput === undefined) {
		state = await runWriterPhase(ctx, state, trackPhase);
	}

	// Deferred until the Writer's request completes so the shared-prefix cache it
	// populated is readable; a concurrent start would miss it.
	if (parallelRun === 'parallelAfterWriter') {
		backgroundPhases = startBackgroundPhases();
	}

	state = await runReviewerEditorPhases(ctx, state, trackPhase);
	state = await runEditorTemplateFitter(ctx, state, trackPhase);
	maybeExtractImportantPhrases(state, callbacks);

	state = await runGamePhases(ctx, state, trackPhase);
	state = await runGmTemplateFitter(ctx, state, trackPhase);

	// Local servers may exhaust their context on concurrent runs: wait until the
	// sequential chain has fully finished.
	if (parallelRun === 'singleThreaded') {
		backgroundPhases = startBackgroundPhases();
	}

	const result = finalizePipelineResult(state, tracker);
	callbacks.onAllComplete(state);
	return { ...result, backgroundPhases };
}

export async function runEpiloguePipeline(input: EpiloguePipelineInput): Promise<PipelineResult> {
	const { endingType, execution, story } = input;
	const { callbacks } = execution;

	const loadedPrompts: LoadedPrompts = await loadPrompts(story.storyId, story.storyName);
	const providerConfigs: PipelineProviderConfigs = buildPipelineProviderConfigs();
	const ctx = await buildPipelineContext(input, loadedPrompts, providerConfigs);

	const tracker = buildTrackPhase(input.initialPhases);
	const trackPhase = buildCommittingTrackPhase(tracker, input.initialState ?? {}, execution.onPhaseCommit);

	let state: PipelineState = { ...input.initialState };
	if (state.writerOutput === undefined) {
		state = await runWriterPhase(ctx, state, trackPhase, getEndingLabel(endingType));
	}
	state = await runReviewerEditorPhases(ctx, state, trackPhase);
	state = await runEditorTemplateFitter(ctx, state, trackPhase);
	maybeExtractImportantPhrases(state, callbacks);

	const result = finalizePipelineResult(state, tracker);
	callbacks.onAllComplete(state);
	return result;
}
