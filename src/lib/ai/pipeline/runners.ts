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
} from './message-builder';
import {
	getReevaluationFrequency,
	isPhraseHighlightingEnabled,
	isPlotPlannerEnabled,
	isQuickReview,
	isReviewerEnabled,
} from '$lib/stores/settings.svelte';
import type { ActPhase, EndingType, GameDataFields, NarrativeVariables, PlotMode } from '../narrative-types';
import { getActPhaseIndex } from '../narrative-types';
import { summaryHeader } from '$lib/definitions/common-headers';
import {
	acceptAsIsLabel,
	editorExtractionPrompt,
	editorTemplateFitterExtractionPrompt,
	gameMasterExtractionPrompt,
	getLocalizedActPhase,
	gmTemplateFitterExtractionPrompt,
	plotPlannerExtractionPrompt,
	quickReviewerExtractionPromptTemplate,
	recommendationLabel,
	reviewerExtractionPromptTemplate,
	templateFitterSystemPrompt,
	totalViolationsLabel,
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

function resolveGmSystemPrompt(ctx: PipelineRunContext): string {
	const phaseAdvancementTrigger =
		ctx.story.actLine.plotMode === 'phaseEvent' && ctx.story.actLine.currentActPhase
			? ls('pipeline.extraction.gmPhaseEventPhaseAdvancementTrigger', { actPhase: getLocalizedActPhase(ctx.story.actLine.currentActPhase) })
			: null;
	const gmActEndTrigger = resolveGmActEndTrigger(ctx);

	const additionalRules: string[] = [];
	if (phaseAdvancementTrigger) additionalRules.push(phaseAdvancementTrigger);
	if (gmActEndTrigger) additionalRules.push(gmActEndTrigger);

	const additionalRulesText = additionalRules.length > 0 ? '\n' + additionalRules.join('\n') : '';

	return ctx.prompts.gameMasterSystemPrompt.replaceAll('{additionalRules}', additionalRulesText);
}

function resolveGmActEndTrigger(ctx: PipelineRunContext): string | null {
	if (ctx.story.actLine.plotMode === 'phaseEvent') {
		if (!isActEndPhase(ctx.story.actLine.currentActPhase ?? null)) return null;
	}
	return ls('pipeline.extraction.gmActEndTrigger');
}

function resolveSummarizedScenes(summarizedScenes: number) {
	return summarizedScenes > 0 ? ls('pipeline.extraction.writer.providedSummary', { summarizedScenes }) : '';
}

function resolveTurnOfEvents(previousTurnOfEvents: string | undefined) {
	return previousTurnOfEvents ? '\n' + ls('pipeline.extraction.writer.providedTurnOfEvents').trim() : '';
}

function resolveDirectorNotes(directorNotes: string) {
	return directorNotes ? '\n' + ls('pipeline.extraction.writer.providedDirectorNotes').trim() : '';
}

function resolveTurnOfEventsReinforcementPhrase(previousTurnOfEvents: string | undefined) {
	return previousTurnOfEvents ? ls('pipeline.extraction.writer.turnOfEventsReinforcementPhrase') : '';
}

function resolveDirectorNotesReinforcementPhrase(directorNotes: string) {
	return directorNotes ? ls('pipeline.extraction.writer.directorNotesReinforcementPhrase') : '';
}

function resolveCurrentActPhase(ctx: PipelineRunContext) {
	return ctx.story.actLine.currentActPhase ? getLocalizedActPhase(ctx.story.actLine.currentActPhase) : '';
}

function resolveActEndInstruction(plotMode: PlotMode, actPhase: ActPhase | null): string {
	const params = {
		closingSceneRules: ls('pipeline.extraction.writer.closingSceneRules').trim(),
		endingTypeInstructions: ls('tools.endAct.endingTypeInstructions').trim(),
	};
	if (plotMode === 'phaseEvent') {
		if (isActEndPhase(actPhase)) return '\n' + ls('pipeline.extraction.writer.actEndPhaseEvent', params).trim();
		return '';
	} else {
		return '\n' + ls('pipeline.extraction.writer.actEndGuidance', params).trim();
	}
}

function isActEndPhase(actPhase: ActPhase | null): boolean {
	const phaseIndex = actPhase ? getActPhaseIndex(actPhase) : -1;
	const minIndex = getActPhaseIndex('falling-action');
	return phaseIndex >= minIndex;
}

// --- buildStateUpdate functions ---

function buildWriterStateUpdate(ss: StreamState): Partial<PipelineState> {
	const writerOutput = fullOutput(ss);
	const writerVariables = ss.variables;
	if (isReviewerEnabled()) {
		return { writerOutput, writerVariables };
	}
	return {
		writerOutput,
		writerVariables,
		editorOutput: writerOutput,
		editorVariables: writerVariables,
		editorReasoning: ss.reasoning,
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
	writerOutputTemplate: string;
	reviewerPrompt: string;
	writerSystemPrompt: string;
	editorSystemPrompt: string;
	gameMasterSystemPrompt: string;
	plotPlannerSystemPrompt: string;
	phaseEventPlotPlannerSystemPrompt: string;
	guidanceWriterExtractionPrompt: string;
	phaseEventWriterExtractionPrompt: string;
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
}

export type TrackPhase = (
	phaseName: string,
	result: { state: PipelineState; metadata: StreamResultMetadata },
	model?: string
) => PipelineState;

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
			.replaceAll('{previousScene}', String(previousSceneNumber))
			.replaceAll('{currentScene}', ctx.currentScene)
			.replaceAll('{summarizedScenes}', String(summarizedScenes))
			.replaceAll('{providedSummary}', resolveSummarizedScenes(summarizedScenes))
			.replaceAll('{providedTurnOfEvents}', resolveTurnOfEvents(previousTurnOfEvents))
			.replaceAll('{providedDirectorNotes}', resolveDirectorNotes(directorNotes))
			.replaceAll('{turnOfEventsReinforcementPhrase}', resolveTurnOfEventsReinforcementPhrase(previousTurnOfEvents))
			.replaceAll('{directorNotesReinforcementPhrase}', resolveDirectorNotesReinforcementPhrase(directorNotes))
			.replaceAll('{currentActPhase}', resolveCurrentActPhase(ctx))
			.replaceAll('{actEndInstruction}', resolveActEndInstruction(ctx.story.actLine.plotMode, ctx.story.actLine.currentActPhase ?? null));

	const result = await executeStreamingPhase(
		{
			phaseName: 'WRITER',
			systemPrompt: ctx.prompts.writerSystemPrompt
				.replaceAll('{generalInstructions}', ctx.prompts.generalInstructions)
				.replaceAll('{targetWordCount}', ctx.effectiveTargetWordCount)
				.replaceAll('{writerOutputTemplate}', ctx.prompts.writerOutputTemplate),
			...ctx.sharedParams,
			tools: filterToolsForPhase(ctx.tools, 'WRITER'),
			descriptors: getNarrativeDescriptors(),
			messages: buildWriterMessages(ctx.preEditorCtx, writerExtractionPrompt),
			providerConfig: ctx.providerConfigs.writer,
			buildStateUpdate: buildWriterStateUpdate,
		},
		state
	);
	return trackPhase('WRITER', result, ctx.providerConfigs.writer?.model);
}

export const ENDING_LABELS: Record<EndingType, string> = {
	good: ls('tools.endAct.endingGood'),
	bad: ls('tools.endAct.endingBad'),
	bittersweet: ls('tools.endAct.endingBittersweet'),
	alternative: ls('tools.endAct.endingAlternative'),
};

export async function runReviewerEditorPhases(
	ctx: PipelineRunContext,
	state: PipelineState,
	trackPhase: TrackPhase
): Promise<PipelineState> {
	if (!isReviewerEnabled()) {
		ctx.sharedParams.callbacks.onPhaseStart('EDITOR');
		ctx.sharedParams.callbacks.onPhaseComplete('EDITOR', state);
		return state;
	}

	const reviewerResult = await executeStreamingPhase(
		{
			phaseName: 'REVIEWER',
			systemPrompt: ctx.prompts.reviewerPrompt
				.replaceAll('{generalInstructions}', ctx.prompts.generalInstructions)
				.replaceAll('{acceptAsIs}', acceptAsIsLabel())
				.replaceAll('{summary}', summaryHeader())
				.replaceAll('{totalViolations}', totalViolationsLabel())
				.replaceAll('{recommendation}', recommendationLabel()),
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
	state = trackPhase('REVIEWER', reviewerResult, ctx.providerConfigs.reviewer?.model);

	if (reviewerAcceptsAsIs(state.reviewerOutput)) {
		state = updateState(state, {
			editorOutput: state.writerOutput,
			editorVariables: state.writerVariables ?? null,
			editorReasoning: null,
		});
		ctx.sharedParams.callbacks.onPhaseStart('EDITOR');
		ctx.sharedParams.callbacks.onPhaseComplete('EDITOR', state);
	} else {
		const editorResult = await executeStreamingPhase(
			{
				phaseName: 'EDITOR',
				systemPrompt: ctx.prompts.editorSystemPrompt
					.replaceAll('{generalInstructions}', ctx.prompts.generalInstructions)
					.replaceAll('{targetWordCount}', ctx.effectiveTargetWordCount)
					.replaceAll('{writerOutputTemplate}', ctx.prompts.writerOutputTemplate),
				...ctx.sharedParams,
				tools: filterToolsForPhase(ctx.tools, 'EDITOR'),
				descriptors: getEditorDescriptors(),
				messages: buildEditorMessages(ctx.preEditorCtx, state.writerOutput, state.reviewerOutput, editorExtractionPrompt()),
				providerConfig: ctx.providerConfigs.editor,
				buildStateUpdate: buildEditorStateUpdate,
			},
			state
		);
		state = trackPhase('EDITOR', editorResult, ctx.providerConfigs.editor?.model);
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

export async function runGamePhases(
	ctx: PipelineRunContext,
	state: PipelineState,
	postEditorCtx: PostEditorContext,
	trackPhase: TrackPhase
): Promise<PipelineState> {
	if (isPlotPlannerEnabled()) {
		const shouldRunPlotPlanner =
			ctx.story.actLine.plotMode === 'guidance' ||
			ctx.story.actLine.lastPlotGeneration == null ||
			postEditorCtx.completedScenes - ctx.story.actLine.lastPlotGeneration >= getReevaluationFrequency();

		if (shouldRunPlotPlanner) {
			const plotPlannerPrompt =
				ctx.story.actLine.plotMode === 'phaseEvent' ? ctx.prompts.phaseEventPlotPlannerSystemPrompt : ctx.prompts.plotPlannerSystemPrompt;

			const [gmResult, plotResult] = await Promise.all([
				executeGmPhase(ctx, state, postEditorCtx),
				executePlotPlannerPhase(plotPlannerPrompt, ctx, postEditorCtx, state),
			]);

			state = trackPhase('GAME_MASTER', gmResult, ctx.providerConfigs.gameMaster?.model);
			state = updateState(state, { scenePlot: plotResult.state.scenePlot });
			trackPhase('PLOT_PLANNER', plotResult, ctx.providerConfigs.plotPlanner?.model);
			return state;
		}

		// GM only, carry forward previous scene plot
		const gmResult = await executeGmPhase(ctx, state, postEditorCtx);
		state = trackPhase('GAME_MASTER', gmResult, ctx.providerConfigs.gameMaster?.model);
		state = updateState(state, { scenePlot: postEditorCtx.previousScenePlot ?? '' });
		return state;
	}

	const gmResult = await executeGmPhase(ctx, state, postEditorCtx);
	return trackPhase('GAME_MASTER', gmResult, ctx.providerConfigs.gameMaster?.model);
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
			systemPrompt: resolveGmSystemPrompt(ctx),
			...ctx.sharedParams,
			tools: filterToolsForPhase(ctx.tools, 'GAME_MASTER'),
			descriptors: getGameMasterDescriptors(),
			messages: buildGamePhaseMessages(postEditorCtx, gameMasterExtractionPrompt()),
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
				.replaceAll('{generalInstructions}', ctx.prompts.generalInstructions)
				.replaceAll('{targetWordCount}', ctx.effectiveTargetWordCount),
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
