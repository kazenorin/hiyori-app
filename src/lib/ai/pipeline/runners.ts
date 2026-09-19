import { type ToolSet } from 'ai';
import { ls } from '$lib/localization';
import {
	buildEditorFitterMessages,
	buildGmFitterMessages,
	buildPhaseMessages,
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
	editorTemplateFitterExtractionPrompt,
	gameMasterInventoryToolsInstruction,
	getLocalizedActPhase,
	gmTemplateFitterExtractionPrompt,
	plotPlannerInventoryToolsInstruction,
	plotPlannerMemoryToolsInstruction,
	quickReviewerInventoryToolsInstruction,
	quickReviewerMemoryToolsInstruction,
	recommendationLabel,
	reviewerInventoryToolsInstruction,
	reviewerMemoryToolsInstruction,
	templateFitterSystemPrompt,
	totalViolationsLabel,
	writerInventoryToolsInstruction,
	writerMemoryToolsInstruction,
} from '$lib/definitions/pipeline-prompts';
import type { AssistantContext, PipelineCallbacks, PipelineContext, PipelineProviderConfigs, PipelineState, StoryContext } from './types';
import { executeStreamingPhase, updateState } from './phase-executor';
import type { StreamResultMetadata } from '../streaming';
import type { StreamState } from '../chat-callbacks';
import { variablesToMarkdown } from '../template-renderer';
import { extractImportantPhrases } from '../important-phrases-extractor';
import { guardToolsForPhase } from '$lib/ai/tools/tools';
import { formatActPhaseBoundariesSection, SECTION } from '$lib/definitions/pipeline-sections';
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

function substituteToolsLine(source: string, name: string, value: string, available: boolean): string {
	const pattern = new RegExp(`^([ \t]*){{${name}}}[ \t]*\r?\n`, 'gm');
	if (!available) return source.replace(pattern, '');
	return source.replace(pattern, (_match: string, indent: string) => indentLines(value.trimEnd(), indent) + '\n');
}

const earlyPhaseFactor = 0.3;
const latePhaseFactor = 1 - earlyPhaseFactor;

/** Resolve the single shared system prompt (persona + general instructions + tools note). */
export function resolveSharedSystemPrompt(prompts: PipelinePrompts): string {
	return prompts.mainChatSystemPrompt.replaceAll('{{generalInstructions}}', prompts.generalInstructions);
}

/** Act Phase Boundaries section text for phaseEvent extraction prompts (empty in guidance mode). */
function resolveActPhaseBoundaries(ctx: PipelineRunContext): string {
	return formatActPhaseBoundariesSection(ctx.story.actLine.actPhaseBoundaries).join('\n');
}

export interface GmExtractionTemplateParams {
	currentScene: string;
	currentActPhase?: string;
	inventoryToolsInstruction: string;
	inventoryAvailable: boolean;
}

export function resolveGmExtractionPrompt(base: string, params: GmExtractionTemplateParams): string {
	const resolved = base
		.replaceAll('{{currentScene}}', params.currentScene)
		.replaceAll('{{currentActPhase}}', params.currentActPhase ?? '')
		.replaceAll('{{additionalRules}}', '');
	return substituteToolsLine(resolved, 'inventoryToolsInstruction', params.inventoryToolsInstruction, params.inventoryAvailable);
}

function resolveGmExtractionPromptForContext(ctx: PipelineRunContext): string {
	const base =
		ctx.story.actLine.plotMode === 'phaseEvent'
			? ctx.prompts.phaseEventGameMasterExtractionPrompt
			: ctx.prompts.guidanceGameMasterExtractionPrompt;
	return resolveGmExtractionPrompt(base, {
		currentScene: ctx.currentScene,
		currentActPhase: resolveCurrentActPhase(ctx),
		inventoryToolsInstruction: gameMasterInventoryToolsInstruction(),
		inventoryAvailable: isInventoryAvailable(),
	}).replaceAll('{{actPhaseBoundaries}}', resolveActPhaseBoundaries(ctx));
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
	guidanceWriterExtractionPrompt: string;
	phaseEventWriterExtractionPrompt: string;
	epilogueWriterExtractionPrompt: string;
	reviewerExtractionPrompt: string;
	quickReviewerExtractionPrompt: string;
	editorExtractionPrompt: string;
	guidancePlotPlannerExtractionPrompt: string;
	phaseEventPlotPlannerExtractionPrompt: string;
	guidanceGameMasterExtractionPrompt: string;
	phaseEventGameMasterExtractionPrompt: string;
}

export interface PipelineRunContext {
	sharedParams: {
		abortSignal: AbortSignal;
		callbacks: PipelineCallbacks;
		retryConfig: { retryCount: number; backoffIntervalSeconds: number };
	};
	providerConfigs: PipelineProviderConfigs;
	prompts: PipelinePrompts;
	effectiveTargetWordCount: string;
	currentScene: string;
	completedScenes: number;
	directorNotes: string;
	previousScenePlot?: string;
	previousTurnOfEvents?: string;
	tools?: ToolSet;
	story: StoryContext;
	assistant: AssistantContext;
	narrativeOverrides: NarrativeOverrides;
	/** Shared-prefix context (Tiers 0–2) reused by every phase this run. */
	context: PipelineContext;
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
	epilogueEndingType?: string
): Promise<PipelineState> {
	const previousSceneNumber = ctx.completedScenes;
	const summarizedScenes = previousSceneNumber - 1;
	const previousTurnOfEvents = ctx.previousTurnOfEvents;
	const directorNotes = ctx.directorNotes;
	const isPhaseEvent = ctx.story.actLine.plotMode === 'phaseEvent';

	const applyWriterSubstitutions = (template: string) =>
		template
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

	// The epilogue swaps the writing task but keeps the same writer role/format scaffolding,
	// so it selects a dedicated base prompt and runs it through the identical substitution
	// chain (targetWordCount, writerOutputTemplate, tool instructions). Those placeholders are
	// absent from the guidance/phaseEvent variants' scaffolding only where noted, so the extra
	// `.replaceAll` passes are no-ops for the non-epilogue path.
	const baseExtractionPrompt = epilogueEndingType
		? ctx.prompts.epilogueWriterExtractionPrompt
		: isPhaseEvent
			? ctx.prompts.phaseEventWriterExtractionPrompt
			: ctx.prompts.guidanceWriterExtractionPrompt;

	let writerExtractionPrompt = applyWriterSubstitutions(baseExtractionPrompt)
		.replaceAll('{{targetWordCount}}', ctx.effectiveTargetWordCount)
		.replaceAll('{{writerOutputTemplate}}', ctx.prompts.writerOutputTemplate)
		.replaceAll('{{actPhaseBoundaries}}', resolveActPhaseBoundaries(ctx))
		.replaceAll('{{endingType}}', epilogueEndingType ?? '');
	writerExtractionPrompt = substituteToolsLine(
		writerExtractionPrompt,
		'memoryToolsInstruction',
		writerMemoryToolsInstruction(),
		isMemoryAvailable()
	);
	writerExtractionPrompt = substituteToolsLine(
		writerExtractionPrompt,
		'inventoryToolsInstruction',
		writerInventoryToolsInstruction(),
		isInventoryAvailable()
	);

	const result = await executeStreamingPhase(
		{
			phaseName: 'WRITER',
			systemPrompt: resolveSharedSystemPrompt(ctx.prompts),
			...ctx.sharedParams,
			tools: guardToolsForPhase(ctx.tools, 'WRITER'),
			descriptors: getNarrativeDescriptors(),
			messages: buildPhaseMessages(ctx.context, [], writerExtractionPrompt, directorNotes),
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
		let reviewerExtraction = (isQuickReview() ? ctx.prompts.quickReviewerExtractionPrompt : ctx.prompts.reviewerExtractionPrompt)
			.replaceAll('{{currentScene}}', ctx.currentScene)
			.replaceAll('{{acceptAsIs}}', acceptAsIsLabel())
			.replaceAll('{{summary}}', summaryHeader())
			.replaceAll('{{totalViolations}}', totalViolationsLabel())
			.replaceAll('{{recommendation}}', recommendationLabel())
			.replaceAll('{{actPhaseBoundaries}}', resolveActPhaseBoundaries(ctx));
		reviewerExtraction = substituteToolsLine(
			reviewerExtraction,
			'memoryToolsInstruction',
			isQuickReview() ? quickReviewerMemoryToolsInstruction() : reviewerMemoryToolsInstruction(),
			isMemoryAvailable()
		);
		reviewerExtraction = substituteToolsLine(
			reviewerExtraction,
			'inventoryToolsInstruction',
			isQuickReview() ? quickReviewerInventoryToolsInstruction() : reviewerInventoryToolsInstruction(),
			isInventoryAvailable()
		);
		const reviewerResult = await executeStreamingPhase(
			{
				phaseName: 'REVIEWER',
				systemPrompt: resolveSharedSystemPrompt(ctx.prompts),
				...ctx.sharedParams,
				tools: guardToolsForPhase(ctx.tools, 'REVIEWER'),
				descriptors: getReviewerDescriptors(),
				messages: buildPhaseMessages(
					ctx.context,
					state.writerOutput ? [SECTION.WRITER_OUTPUT + state.writerOutput] : [],
					reviewerExtraction,
					ctx.directorNotes
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
		const editorExtraction = ctx.prompts.editorExtractionPrompt
			.replaceAll('{{currentScene}}', ctx.currentScene)
			.replaceAll('{{targetWordCount}}', ctx.effectiveTargetWordCount)
			.replaceAll('{{writerOutputTemplate}}', ctx.prompts.writerOutputTemplate)
			.replaceAll('{{actPhaseBoundaries}}', resolveActPhaseBoundaries(ctx));
		const editorResult = await executeStreamingPhase(
			{
				phaseName: 'EDITOR',
				systemPrompt: resolveSharedSystemPrompt(ctx.prompts),
				...ctx.sharedParams,
				tools: guardToolsForPhase(ctx.tools, 'EDITOR'),
				descriptors: getEditorDescriptors(),
				messages: buildPhaseMessages(
					ctx.context,
					[
						...(state.writerOutput ? [SECTION.WRITER_OUTPUT + state.writerOutput] : []),
						...(state.reviewerOutput ? [SECTION.REVIEWER_OUTPUT + state.reviewerOutput] : []),
					],
					editorExtraction,
					ctx.directorNotes
				),
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

/** Plot Planner extraction prompt: selects the guidance/phaseEvent variant, then resolves scene/phase and tool placeholders. */
function resolvePlotPlannerExtractionPromptForContext(ctx: PipelineRunContext): string {
	const isPhaseEvent = ctx.story.actLine.plotMode === 'phaseEvent';
	const base = isPhaseEvent
		? ctx.prompts.phaseEventPlotPlannerExtractionPrompt.replaceAll(
				'{{currentActPhase}}',
				getLocalizedActPhase(ctx.story.actLine.currentActPhase ?? 'introduction')
			)
		: ctx.prompts.guidancePlotPlannerExtractionPrompt.replaceAll('{{currentScene}}', ctx.currentScene);
	let resolved = base
		.replaceAll('{{targetWordCount}}', ctx.effectiveTargetWordCount)
		.replaceAll('{{actPhaseBoundaries}}', resolveActPhaseBoundaries(ctx));
	resolved = substituteToolsLine(resolved, 'memoryToolsInstruction', plotPlannerMemoryToolsInstruction(), isMemoryAvailable());
	resolved = substituteToolsLine(resolved, 'inventoryToolsInstruction', plotPlannerInventoryToolsInstruction(), isInventoryAvailable());
	return resolved;
}

export async function runGamePhases(ctx: PipelineRunContext, state: PipelineState, trackPhase: TrackPhase): Promise<PipelineState> {
	// Resume gates: outputs already present in state (fresh or cached) are skipped.
	const gmPending = state.gameMasterOutput === undefined;
	const plotPlannerPending = state.scenePlot === undefined;
	if (!gmPending && !plotPlannerPending) return state;

	const plotPlannerShouldRun =
		isPlotPlannerEnabled() &&
		(ctx.story.actLine.plotMode === 'guidance' ||
			ctx.story.actLine.lastPlotGeneration == null ||
			ctx.completedScenes - ctx.story.actLine.lastPlotGeneration >= getReevaluationFrequency());

	const runPlotPlanner = plotPlannerPending && plotPlannerShouldRun;

	if (gmPending && runPlotPlanner) {
		const gmPromise = executeGmPhase(ctx, state);
		const plotPromise = executePlotPlannerPhase(ctx, state);

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
		const gmResult = await executeGmPhase(ctx, state);
		state = await trackPhase('GAME_MASTER', gmResult, ctx.providerConfigs.gameMaster?.model);
	} else if (runPlotPlanner) {
		// GM already completed (resumed from cache); only the Plot Planner remains
		const plotResult = await executePlotPlannerPhase(ctx, state);
		state = updateState(state, { scenePlot: plotResult.state.scenePlot });
		await trackPhase('PLOT_PLANNER', plotResult, ctx.providerConfigs.plotPlanner?.model);
		return state;
	}

	// Plot Planner does not run (disabled, or re-evaluation frequency not elapsed):
	// when the feature is enabled, carry forward the previous scene plot.
	if (plotPlannerPending && isPlotPlannerEnabled()) {
		state = updateState(state, { scenePlot: ctx.previousScenePlot ?? '' });
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

export function executeGmPhase(ctx: PipelineRunContext, state: PipelineState) {
	return executeStreamingPhase(
		{
			phaseName: 'GAME_MASTER',
			systemPrompt: resolveSharedSystemPrompt(ctx.prompts),
			...ctx.sharedParams,
			tools: guardToolsForPhase(ctx.tools, 'GAME_MASTER'),
			descriptors: getGameMasterDescriptors(),
			messages: buildPhaseMessages(
				ctx.context,
				state.editorOutput ? [SECTION.EDITOR_OUTPUT + state.editorOutput] : [],
				resolveGmExtractionPromptForContext(ctx),
				ctx.directorNotes
			),
			providerConfig: ctx.providerConfigs.gameMaster,
			buildStateUpdate: buildGmStateUpdate,
		},
		state
	);
}

function executePlotPlannerPhase(ctx: PipelineRunContext, state: PipelineState) {
	return executeStreamingPhase(
		{
			phaseName: 'PLOT_PLANNER',
			systemPrompt: resolveSharedSystemPrompt(ctx.prompts),
			...ctx.sharedParams,
			tools: guardToolsForPhase(ctx.tools, 'PLOT_PLANNER'),
			descriptors: getPlotPlannerDescriptors(),
			messages: buildPhaseMessages(
				ctx.context,
				state.editorOutput ? [SECTION.EDITOR_OUTPUT + state.editorOutput] : [],
				resolvePlotPlannerExtractionPromptForContext(ctx),
				ctx.directorNotes
			),
			providerConfig: ctx.providerConfigs.plotPlanner,
			buildStateUpdate: buildPlotPlannerStateUpdate,
		},
		state
	);
}
