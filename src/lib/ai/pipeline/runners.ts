import { type ToolSet } from 'ai';
import { ls } from '$lib/localization';
import {
	buildEditorFitterMessages,
	buildEditorMessages,
	buildGamePhaseMessages,
	buildGmFitterMessages,
	buildReviewerMessages,
	buildWriterMessages,
	editorHasTemplateMetadata,
	fullOutput,
	mergeGameData,
	mergeVariables,
	applyNarrativeOverrides,
} from './message-builder';
import {
	getReevaluationFrequency,
	isInventoryAvailable,
	isMemoryAvailable,
	isPhraseHighlightingEnabled,
	isPlotPlannerEnabled,
	isQuickReview,
	isReviewerEnabled,
} from '$lib/stores/settings.svelte';
import type { ActPhase, EndingType, GameDataFields, NarrativeOverrides, NarrativeVariables, PlotMode } from '../narrative-types';
import { getActPhaseIndex } from '../narrative-types';
import { summaryHeader } from '$lib/definitions/common-headers';
import {
	writerProvidedSummary,
	writerProvidedTurnOfEvents,
	writerTurnOfEventsReinforcementPhrase,
	writerProvidedDirectorNotes,
	writerDirectorNotesReinforcementPhrase,
	writerClosingSceneRules,
	writerActEndPhaseEvent,
	writerActEndGuidance,
} from '$lib/definitions/pipeline-prompts';
import {
	acceptAsIsLabel,
	editorExtractionPrompt,
	editorTemplateFitterExtractionPrompt,
	gameMasterInventoryToolsInstruction,
	getLocalizedActPhase,
	gmTemplateFitterExtractionPrompt,
	plotPlannerExtractionPrompt,
	plotPlannerInventoryToolsInstruction,
	plotPlannerMemoryToolsInstruction,
	quickReviewerExtractionPromptTemplate,
	quickReviewerInventoryToolsInstruction,
	quickReviewerMemoryToolsInstruction,
	recommendationLabel,
	reviewerExtractionPromptTemplate,
	reviewerInventoryToolsInstruction,
	reviewerMemoryToolsInstruction,
	templateFitterSystemPrompt,
	totalViolationsLabel,
	writerInventoryToolsInstruction,
	writerMemoryToolsInstruction,
} from '$lib/definitions/pipeline-prompts';
import type {
	AssistantContext,
	PipelineCallbacks,
	PipelineProviderConfigs,
	PipelineState,
	PostEditorContext,
	PreEditorContext,
	StoryContext,
} from './types';
import { executeStreamingPhase, updateState } from './phase-executor';
import type { StreamResultMetadata } from '../streaming';
import type { StreamState } from '../chat-callbacks';
import { variablesToMarkdown } from '../template-renderer';
import { extractImportantPhrases } from '../important-phrases-extractor';
import { filterToolsForPhase } from '$lib/ai/tools/tools';
import { log } from '$lib/logging/logger';
import { reviewerAcceptsAsIs } from '../reviewer-output-parser';
import {
	getEditorDescriptors,
	getEditorTemplateFitterDescriptors,
	getGameMasterDescriptors,
	getGmTemplateFitterDescriptors,
	getNarrativeDescriptors,
	getPlotPlannerDescriptors,
	getReviewerDescriptors,
} from '../descriptors';

export const defaultTargetWordCount = 400;

function indentLines(text: string, prefix: string): string {
	return text
		.split(/\r?\n/)
		.map((line) => (line ? prefix + line : line))
		.join('\n');
}

function memoryToolsPartial(value: string): string {
	return isMemoryAvailable() ? value.trimEnd() + '\n' : '';
}

function inventoryToolsPartial(value: string): string {
	return isInventoryAvailable() ? value.trimEnd() + '\n' : '';
}

const earlyPhaseFactor = 0.3;
const latePhaseFactor = 1 - earlyPhaseFactor;

export function resolveGmSystemPrompt(systemPrompt: string): string {
	return systemPrompt.replaceAll('{{additionalRules}}', '');
}

export interface GmExtractionTemplateParams {
	currentScene: string;
	currentActPhase?: string;
	inventoryToolsInstruction: string;
}

export function resolveGmExtractionPrompt(base: string, params: GmExtractionTemplateParams): string {
	return base
		.replaceAll('{{currentScene}}', params.currentScene)
		.replaceAll('{{currentActPhase}}', params.currentActPhase ?? '')
		.replaceAll(/{{inventoryToolsInstruction}}\r?\n/g, params.inventoryToolsInstruction)
		.replaceAll('{{additionalRules}}', '');
}

function resolveGmExtractionPromptForContext(ctx: PipelineRunContext): string {
	const base =
		ctx.story.actLine.plotMode === 'phaseEvent'
			? ctx.prompts.phaseEventGameMasterExtractionPrompt
			: ctx.prompts.guidanceGameMasterExtractionPrompt;
	return resolveGmExtractionPrompt(base, {
		currentScene: ctx.currentScene,
		currentActPhase: resolveCurrentActPhase(ctx),
		inventoryToolsInstruction: inventoryToolsPartial(indentLines(gameMasterInventoryToolsInstruction(), '   ')),
	});
}

function resolveSummarizedScenes(summarizedScenes: number) {
	return summarizedScenes > 0 ? writerProvidedSummary(summarizedScenes) : '';
}

function resolveTurnOfEvents(previousTurnOfEvents: string | undefined) {
	return previousTurnOfEvents ? '\n' + writerProvidedTurnOfEvents().trim() : '';
}

function resolveDirectorNotes(directorNotes: string) {
	return directorNotes ? '\n' + writerProvidedDirectorNotes().trim() : '';
}

function resolveTurnOfEventsReinforcementPhrase(previousTurnOfEvents: string | undefined) {
	return previousTurnOfEvents ? writerTurnOfEventsReinforcementPhrase() : '';
}

function resolveDirectorNotesReinforcementPhrase(directorNotes: string) {
	return directorNotes ? writerDirectorNotesReinforcementPhrase() : '';
}

function resolveCurrentActPhase(ctx: PipelineRunContext) {
	return ctx.story.actLine.currentActPhase ? getLocalizedActPhase(ctx.story.actLine.currentActPhase) : '';
}

function resolveCurrentActPhaseProgress(ctx: PipelineRunContext): number {
	const currentSceneNumber = parseInt(ctx.currentScene, 10);
	if (Number.isNaN(currentSceneNumber)) {
		return 0;
	}

	const { actPhaseBoundaries, currentActPhase } = ctx.story.actLine;
	const phaseBoundary = actPhaseBoundaries.find((p) => p.phase === currentActPhase);

	if (phaseBoundary?.sceneNumber !== undefined && phaseBoundary.sceneNumber <= currentSceneNumber) {
		return currentSceneNumber - phaseBoundary.sceneNumber;
	}

	return currentSceneNumber;
}

function calculatePhaseThreshold(ctx: PipelineRunContext, factor: number, minThreshold: number): number {
	const phaseLengthEstimate = resolveEstimatedPhaseLength(ctx);

	if (phaseLengthEstimate > 2) {
		const threshold = Math.floor(phaseLengthEstimate * factor);
		return Math.max(minThreshold, threshold);
	}

	return minThreshold;
}

function resolveEarlyPhaseThreshold(ctx: PipelineRunContext) {
	return calculatePhaseThreshold(ctx, earlyPhaseFactor, 1);
}

function resolveLatePhaseThreshold(ctx: PipelineRunContext) {
	return calculatePhaseThreshold(ctx, latePhaseFactor, 2);
}

function resolveEstimatedPhaseLength(ctx: PipelineRunContext) {
	return ctx.story.actLine.currentActPhaseLengthEstimate ?? 2;
}

function resolveActEndInstruction(plotMode: PlotMode, actPhase: ActPhase | null): string {
	const params = {
		closingSceneRules: writerClosingSceneRules().trim(),
		endingTypeInstructions: ls('tools.endAct.endingTypeInstructions').trim(),
	};
	if (plotMode === 'phaseEvent') {
		if (isActEndPhase(actPhase)) return '\n' + writerActEndPhaseEvent(params).trim();
		return '';
	} else {
		return '\n' + writerActEndGuidance(params).trim();
	}
}

function isActEndPhase(actPhase: ActPhase | null): boolean {
	const phaseIndex = actPhase ? getActPhaseIndex(actPhase) : -1;
	const minIndex = getActPhaseIndex('falling-action');
	return phaseIndex >= minIndex;
}

// --- buildStateUpdate functions ---

function buildWriterStateUpdate(overrides: NarrativeOverrides): (ss: StreamState) => Partial<PipelineState> {
	return (ss: StreamState): Partial<PipelineState> => {
		const effectiveSs: StreamState = { ...ss, variables: applyNarrativeOverrides(ss.variables, overrides) };
		const writerOutput = fullOutput(effectiveSs);
		const writerVariables = effectiveSs.variables;
		if (isReviewerEnabled()) {
			return { writerOutput, writerVariables };
		}
		return {
			writerOutput,
			writerVariables,
			editorOutput: writerOutput,
			editorVariables: writerVariables,
			editorReasoning: effectiveSs.reasoning,
		};
	};
}

function buildEditorStateUpdate(ss: StreamState): Partial<PipelineState> {
	return {
		editorOutput: fullOutput(ss),
		editorVariables: ss.variables,
		editorReasoning: ss.reasoning,
	};
}

function buildGmStateUpdate(ss: StreamState): Partial<PipelineState> {
	return {
		gameMasterOutput: ss.content,
		gameData: ss.variables?.gameData ?? null,
	};
}

function buildPlotPlannerStateUpdate(ss: StreamState): Partial<PipelineState> {
	return { scenePlot: ss.content };
}

function buildEditorFitterStateUpdate(originalVars: NarrativeVariables | null, currentEditorOutput: string) {
	return (ss: StreamState): Partial<PipelineState> => {
		const merged = mergeVariables(originalVars, ss.variables);
		return {
			editorVariables: merged,
			editorOutput: merged ? variablesToMarkdown(merged) : currentEditorOutput,
		};
	};
}

function buildGmFitterStateUpdate(originalGameData: GameDataFields | null) {
	return (ss: StreamState): Partial<PipelineState> => {
		const merged = mergeGameData(originalGameData, ss.variables?.gameData ?? null);
		return { gameData: merged };
	};
}

// --- Phase runner context ---

export interface PipelinePrompts {
	generalInstructions: string;
	mainChatSystemPrompt: string;
	writerOutputTemplate: string;
	reviewerPrompt: string;
	writerSystemPrompt: string;
	editorSystemPrompt: string;
	gameMasterSystemPrompt: string;
	plotPlannerSystemPrompt: string;
	phaseEventPlotPlannerSystemPrompt: string;
	guidanceWriterExtractionPrompt: string;
	phaseEventWriterExtractionPrompt: string;
	guidanceWriterExtractionPromptV2: string;
	phaseEventWriterExtractionPromptV2: string;
	guidanceGameMasterExtractionPrompt: string;
	phaseEventGameMasterExtractionPrompt: string;
	guidanceGameMasterExtractionPromptV2: string;
	phaseEventGameMasterExtractionPromptV2: string;
}

export interface PipelineRunContext {
	sharedParams: {
		abortSignal: AbortSignal;
		callbacks: PipelineCallbacks;
		retryConfig: { retryCount: number; backoffIntervalSeconds: number };
	};
	providerConfigs: PipelineProviderConfigs;
	preEditorCtx: PreEditorContext;
	prompts: PipelinePrompts;
	effectiveTargetWordCount: string;
	currentScene: string;
	tools?: ToolSet;
	story: StoryContext;
	assistant: AssistantContext;
	narrativeOverrides: NarrativeOverrides;
}

/**
 * Records a completed phase (metadata aggregation) and returns the new state.
 * May be async: the pipeline wraps this to persist the phase cache after
 * every completed phase.
 */
export type TrackPhase = (
	phaseName: string,
	result: { state: PipelineState; metadata: StreamResultMetadata },
	model?: string
) => PipelineState | Promise<PipelineState>;

// --- Phase runner functions ---

export async function runWriterPhase(
	ctx: PipelineRunContext,
	state: PipelineState,
	trackPhase: TrackPhase,
	extractionPromptOverride?: string
): Promise<PipelineState> {
	const previousSceneNumber = ctx.preEditorCtx.completedScenes;
	const summarizedScenes = previousSceneNumber - 1;
	const previousTurnOfEvents = ctx.preEditorCtx.previousTurnOfEvents;
	const directorNotes = ctx.preEditorCtx.directorNotes;

	const writerExtractionPromptTemplate =
		ctx.story.actLine.plotMode === 'phaseEvent' ? ctx.prompts.phaseEventWriterExtractionPrompt : ctx.prompts.guidanceWriterExtractionPrompt;

	const writerExtractionPrompt =
		extractionPromptOverride ??
		writerExtractionPromptTemplate
			.replaceAll('{{previousScene}}', String(previousSceneNumber))
			.replaceAll('{{currentScene}}', ctx.currentScene)
			.replaceAll('{{providedSummary}}', resolveSummarizedScenes(summarizedScenes))
			.replaceAll('{{providedTurnOfEvents}}', resolveTurnOfEvents(previousTurnOfEvents))
			.replaceAll('{{providedDirectorNotes}}', resolveDirectorNotes(directorNotes))
			.replaceAll('{{turnOfEventsReinforcementPhrase}}', resolveTurnOfEventsReinforcementPhrase(previousTurnOfEvents))
			.replaceAll('{{directorNotesReinforcementPhrase}}', resolveDirectorNotesReinforcementPhrase(directorNotes))
			.replaceAll('{{currentActPhase}}', resolveCurrentActPhase(ctx))
			.replaceAll('{{currentActPhaseProgress}}', resolveCurrentActPhaseProgress(ctx).toString())
			.replaceAll('{{earlyPhaseThreshold}}', resolveEarlyPhaseThreshold(ctx).toString())
			.replaceAll('{{latePhaseThreshold}}', resolveLatePhaseThreshold(ctx).toString())
			.replaceAll('{{estimatedPhaseLength}}', resolveEstimatedPhaseLength(ctx).toString())
			.replaceAll('{{actEndInstruction}}', resolveActEndInstruction(ctx.story.actLine.plotMode, ctx.story.actLine.currentActPhase ?? null));

	const result = await executeStreamingPhase(
		{
			phaseName: 'WRITER',
			systemPrompt: ctx.prompts.writerSystemPrompt
				.replaceAll('{{generalInstructions}}', ctx.prompts.generalInstructions)
				.replaceAll('{{targetWordCount}}', ctx.effectiveTargetWordCount)
				.replaceAll('{{writerOutputTemplate}}', ctx.prompts.writerOutputTemplate)
				.replaceAll(/{{memoryToolsInstruction}}\r?\n/g, memoryToolsPartial(indentLines(writerMemoryToolsInstruction(), '   ')))
				.replaceAll(/{{inventoryToolsInstruction}}\r?\n/g, inventoryToolsPartial(indentLines(writerInventoryToolsInstruction(), '   '))),
			...ctx.sharedParams,
			tools: filterToolsForPhase(ctx.tools, 'WRITER'),
			descriptors: getNarrativeDescriptors(),
			messages: buildWriterMessages(ctx.preEditorCtx, writerExtractionPrompt),
			providerConfig: ctx.providerConfigs.writer,
			buildStateUpdate: buildWriterStateUpdate(ctx.narrativeOverrides),
		},
		state
	);
	return trackPhase('WRITER', result, ctx.providerConfigs.writer?.model);
}

export function getEndingLabel(endingType: EndingType): string {
	const labels: Record<EndingType, string> = {
		good: ls('common.descriptions.endings.good'),
		bad: ls('common.descriptions.endings.bad'),
		bittersweet: ls('common.descriptions.endings.bittersweet'),
		alternative: ls('common.descriptions.endings.alternative'),
	};
	return labels[endingType];
}

/**
 * Seed editor output from writer output (reviewer disabled or "accept as-is").
 * On a fresh run the writer's buildStateUpdate already did this; on resume the
 * writer output may come from the phase cache, so seed defensively.
 */
function seedEditorFromWriter(state: PipelineState): PipelineState {
	if (state.editorOutput !== undefined) return state;
	return updateState(state, {
		editorOutput: state.writerOutput,
		editorVariables: state.writerVariables ?? null,
		editorReasoning: null,
	});
}

export async function runReviewerEditorPhases(
	ctx: PipelineRunContext,
	state: PipelineState,
	trackPhase: TrackPhase
): Promise<PipelineState> {
	if (!isReviewerEnabled()) {
		state = seedEditorFromWriter(state);
		ctx.sharedParams.callbacks.onPhaseStart('EDITOR');
		ctx.sharedParams.callbacks.onPhaseComplete('EDITOR', state);
		return state;
	}

	if (state.reviewerOutput === undefined) {
		const reviewerResult = await executeStreamingPhase(
			{
				phaseName: 'REVIEWER',
				systemPrompt: ctx.prompts.reviewerPrompt
					.replaceAll('{{generalInstructions}}', ctx.prompts.generalInstructions)
					.replaceAll('{{acceptAsIs}}', acceptAsIsLabel())
					.replaceAll('{{summary}}', summaryHeader())
					.replaceAll('{{totalViolations}}', totalViolationsLabel())
					.replaceAll('{{recommendation}}', recommendationLabel())
					.replaceAll(
						/{{memoryToolsInstruction}}\r?\n/g,
						memoryToolsPartial(isQuickReview() ? quickReviewerMemoryToolsInstruction() : reviewerMemoryToolsInstruction())
					)
					.replaceAll(
						/{{inventoryToolsInstruction}}\r?\n/g,
						inventoryToolsPartial(isQuickReview() ? quickReviewerInventoryToolsInstruction() : reviewerInventoryToolsInstruction())
					),
				...ctx.sharedParams,
				tools: filterToolsForPhase(ctx.tools, 'REVIEWER'),
				descriptors: getReviewerDescriptors(),
				messages: buildReviewerMessages(
					ctx.preEditorCtx,
					state.writerOutput,
					isQuickReview() ? quickReviewerExtractionPromptTemplate(ctx.currentScene) : reviewerExtractionPromptTemplate(ctx.currentScene)
				),
				providerConfig: ctx.providerConfigs.reviewer,
				buildStateUpdate: (ss) => ({ reviewerOutput: ss.content }),
			},
			state
		);
		state = await trackPhase('REVIEWER', reviewerResult, ctx.providerConfigs.reviewer?.model);
	}

	if (reviewerAcceptsAsIs(state.reviewerOutput)) {
		state = seedEditorFromWriter(state);
		ctx.sharedParams.callbacks.onPhaseStart('EDITOR');
		ctx.sharedParams.callbacks.onPhaseComplete('EDITOR', state);
	} else if (state.editorOutput === undefined) {
		const editorResult = await executeStreamingPhase(
			{
				phaseName: 'EDITOR',
				systemPrompt: ctx.prompts.editorSystemPrompt
					.replaceAll('{{generalInstructions}}', ctx.prompts.generalInstructions)
					.replaceAll('{{targetWordCount}}', ctx.effectiveTargetWordCount)
					.replaceAll('{{writerOutputTemplate}}', ctx.prompts.writerOutputTemplate),
				...ctx.sharedParams,
				tools: filterToolsForPhase(ctx.tools, 'EDITOR'),
				descriptors: getEditorDescriptors(),
				messages: buildEditorMessages(ctx.preEditorCtx, state.writerOutput, state.reviewerOutput, editorExtractionPrompt()),
				providerConfig: ctx.providerConfigs.editor,
				buildStateUpdate: buildEditorStateUpdate,
			},
			state
		);
		state = await trackPhase('EDITOR', editorResult, ctx.providerConfigs.editor?.model);
	}

	return state;
}

export async function runEditorTemplateFitter(
	ctx: PipelineRunContext,
	state: PipelineState,
	trackPhase: TrackPhase
): Promise<PipelineState> {
	if (editorHasTemplateMetadata(state.editorVariables) || !state.editorOutput) return state;

	const result = await executeStreamingPhase(
		{
			phaseName: 'TEMPLATE_FITTER',
			systemPrompt: templateFitterSystemPrompt(),
			...ctx.sharedParams,
			tools: undefined,
			descriptors: getEditorTemplateFitterDescriptors(),
			messages: buildEditorFitterMessages(
				state.editorOutput ?? '',
				ctx.prompts.writerOutputTemplate,
				editorTemplateFitterExtractionPrompt()
			),
			providerConfig: ctx.providerConfigs.minorTaskAgent,
			buildStateUpdate: buildEditorFitterStateUpdate(state.editorVariables ?? null, state.editorOutput),
		},
		state
	);
	return trackPhase('EDITOR_TEMPLATE_FITTER', result, ctx.providerConfigs.minorTaskAgent?.model);
}

export function maybeExtractImportantPhrases(state: PipelineState, callbacks: PipelineCallbacks): void {
	if (!isPhraseHighlightingEnabled()) return;
	const narrativeBody = state.editorVariables?.narrativeBody;
	if (!narrativeBody || narrativeBody.trim().length === 0) return;

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

function resolvePlotPlannerPrompt(ctx: PipelineRunContext): string {
	return ctx.story.actLine.plotMode === 'phaseEvent' ? ctx.prompts.phaseEventPlotPlannerSystemPrompt : ctx.prompts.plotPlannerSystemPrompt;
}

export async function runGamePhases(
	ctx: PipelineRunContext,
	state: PipelineState,
	postEditorCtx: PostEditorContext,
	trackPhase: TrackPhase
): Promise<PipelineState> {
	// Resume gates: outputs already present in state (fresh or cached) are skipped.
	const gmPending = state.gameMasterOutput === undefined;
	const plotPlannerPending = state.scenePlot === undefined;
	if (!gmPending && !plotPlannerPending) return state;

	const plotPlannerShouldRun =
		isPlotPlannerEnabled() &&
		(ctx.story.actLine.plotMode === 'guidance' ||
			ctx.story.actLine.lastPlotGeneration == null ||
			postEditorCtx.completedScenes - ctx.story.actLine.lastPlotGeneration >= getReevaluationFrequency());

	const runPlotPlanner = plotPlannerPending && plotPlannerShouldRun;

	if (gmPending && runPlotPlanner) {
		const gmPromise = executeGmPhase(ctx, state, postEditorCtx);
		const plotPromise = executePlotPlannerPhase(resolvePlotPlannerPrompt(ctx), ctx, postEditorCtx, state);

		// Track each phase as soon as it completes so an interruption or failure
		// of the sibling phase cannot lose the completed one's cached output.
		const gmSettled = gmPromise.then((r) => trackPhase('GAME_MASTER', r, ctx.providerConfigs.gameMaster?.model)).catch(() => {});
		const plotSettled = plotPromise.then((r) => trackPhase('PLOT_PLANNER', r, ctx.providerConfigs.plotPlanner?.model)).catch(() => {});

		try {
			const [gmResult, plotResult] = await Promise.all([gmPromise, plotPromise]);
			await gmSettled;
			await plotSettled;
			return updateState(gmResult.state, { scenePlot: plotResult.state.scenePlot });
		} catch (err) {
			// Let the successful sibling's cache commit finish before propagating.
			await Promise.allSettled([gmSettled, plotSettled]);
			throw err;
		}
	}

	if (gmPending) {
		const gmResult = await executeGmPhase(ctx, state, postEditorCtx);
		state = await trackPhase('GAME_MASTER', gmResult, ctx.providerConfigs.gameMaster?.model);
	} else if (runPlotPlanner) {
		// GM already completed (resumed from cache); only the Plot Planner remains
		const plotResult = await executePlotPlannerPhase(resolvePlotPlannerPrompt(ctx), ctx, postEditorCtx, state);
		state = updateState(state, { scenePlot: plotResult.state.scenePlot });
		await trackPhase('PLOT_PLANNER', plotResult, ctx.providerConfigs.plotPlanner?.model);
		return state;
	}

	// Plot Planner does not run (disabled, or re-evaluation frequency not elapsed):
	// when the feature is enabled, carry forward the previous scene plot.
	if (plotPlannerPending && isPlotPlannerEnabled()) {
		state = updateState(state, { scenePlot: postEditorCtx.previousScenePlot ?? '' });
	}
	return state;
}

export async function runGmTemplateFitter(ctx: PipelineRunContext, state: PipelineState, trackPhase: TrackPhase): Promise<PipelineState> {
	if (state.gameData?.decisions?.length || !state.gameMasterOutput) return state;

	const result = await executeStreamingPhase(
		{
			phaseName: 'TEMPLATE_FITTER',
			systemPrompt: templateFitterSystemPrompt(),
			...ctx.sharedParams,
			tools: undefined,
			descriptors: getGmTemplateFitterDescriptors(),
			messages: buildGmFitterMessages(state.editorOutput ?? '', state.gameMasterOutput ?? '', gmTemplateFitterExtractionPrompt()),
			providerConfig: ctx.providerConfigs.minorTaskAgent,
			buildStateUpdate: buildGmFitterStateUpdate(state.gameData ?? null),
		},
		state
	);
	return trackPhase('GM_TEMPLATE_FITTER', result, ctx.providerConfigs.minorTaskAgent?.model);
}

export function executeGmPhase(ctx: PipelineRunContext, state: PipelineState, postEditorCtx: PostEditorContext) {
	return executeStreamingPhase(
		{
			phaseName: 'GAME_MASTER',
			systemPrompt: resolveGmSystemPrompt(ctx.prompts.gameMasterSystemPrompt),
			...ctx.sharedParams,
			tools: filterToolsForPhase(ctx.tools, 'GAME_MASTER'),
			descriptors: getGameMasterDescriptors(),
			messages: buildGamePhaseMessages(postEditorCtx, resolveGmExtractionPromptForContext(ctx)),
			providerConfig: ctx.providerConfigs.gameMaster,
			buildStateUpdate: buildGmStateUpdate,
		},
		state
	);
}

function executePlotPlannerPhase(
	plotPlannerPrompt: string,
	ctx: PipelineRunContext,
	postEditorCtx: PostEditorContext,
	state: PipelineState
) {
	return executeStreamingPhase(
		{
			phaseName: 'PLOT_PLANNER',
			systemPrompt: plotPlannerPrompt
				.replaceAll('{{generalInstructions}}', ctx.prompts.generalInstructions)
				.replaceAll('{{targetWordCount}}', ctx.effectiveTargetWordCount)
				.replaceAll(/{{memoryToolsInstruction}}\r?\n/g, memoryToolsPartial(plotPlannerMemoryToolsInstruction()))
				.replaceAll(/{{inventoryToolsInstruction}}\r?\n/g, inventoryToolsPartial(plotPlannerInventoryToolsInstruction())),
			...ctx.sharedParams,
			tools: filterToolsForPhase(ctx.tools, 'PLOT_PLANNER'),
			descriptors: getPlotPlannerDescriptors(),
			messages: buildGamePhaseMessages(
				postEditorCtx,
				plotPlannerExtractionPrompt(ctx.story.actLine.plotMode, ctx.currentScene, ctx.story.actLine.currentActPhase)
			),
			providerConfig: ctx.providerConfigs.plotPlanner,
			buildStateUpdate: buildPlotPlannerStateUpdate,
		},
		state
	);
}
