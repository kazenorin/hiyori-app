import type { GameDataFields, PhaseName } from './narrative-types';
import type { Story } from '$lib/db/stories';
import { getActPhase, getActPhaseBoundaries, type ActLineMeta } from '$lib/db/act-lines';
import { getDefaultPlotMode } from '$lib/stores/settings.svelte';
import { log } from '$lib/logging/logger';
import { buildPipelineProviderConfigs } from './chat/pipeline-config';
import { createOptionalCallbacks } from './chat/pipeline-callbacks';
import { loadPrompts } from './pipeline/prompt-loader';
import { executeGmPhase, runGmTemplateFitter, type PipelineRunContext, type TrackPhase } from './pipeline/runners';
import type { PipelineContext, PipelineState } from './pipeline/types';
import { buildImportRunContext } from '$lib/features/import-world/pipeline-context';

export interface GameMasterRegenerationInput {
	story: Story;
	actLine: ActLineMeta;
	/** Act ordinal for the GM act-line override (Story-So-Far labelling lives on the summaries). */
	actNumber: number;
	sceneNumber: number;
	/** The scene's rendered editor output the GM re-derives game data from. */
	editorOutput: string;
	/** Caller-assembled Tiers 0–2 prefix (rich for the chat flow, reduced for fork enrichment). */
	context: PipelineContext;
	abortSignal: AbortSignal;
}

/**
 * Run the Game Master phase headlessly over a caller-supplied PipelineContext, then the GM
 * template fitter, and return the regenerated game data. This is the single shared path used by
 * both the chat regenerate-game-data flow and the world-builder fork enrichment, so prompt
 * assembly, plotMode selection, and format fallbacks stay identical to a live run instead of
 * being reimplemented per caller. Returns null when no game-master provider/model is configured
 * (or the model produced nothing usable); the fitter fills an empty `decisions` array.
 */
export async function runGameMasterRegeneration(params: GameMasterRegenerationInput): Promise<GameDataFields | null> {
	const { story, actLine, actNumber, sceneNumber, editorOutput, context, abortSignal } = params;
	const providerConfigs = buildPipelineProviderConfigs();
	if (!providerConfigs.gameMaster?.model) {
		await log.warn('regenerate-metadata', 'No GM provider configured, skipping game data regeneration');
		return null;
	}

	const plotMode = actLine.plotMode ?? getDefaultPlotMode();
	const currentActPhase = await getActPhase(actLine.id);
	const actPhaseBoundaries = await getActPhaseBoundaries(actLine.id);
	const loadedPrompts = await loadPrompts(story.id, story.name);

	const ctx: PipelineRunContext = buildImportRunContext(
		{ retryCount: 3, backoffIntervalSeconds: 5 },
		abortSignal,
		createOptionalCallbacks({
			onError: (_phase: PhaseName, err: unknown) => {
				log.error('regenerate-metadata', 'GM phase error', err);
			},
		}),
		{
			generalInstructions: loadedPrompts.generalInstructions,
			mainChatSystemPrompt: loadedPrompts.mainChatSystemPrompt,
			guidanceGameMasterExtractionPrompt: loadedPrompts.guidanceGameMasterExtractionPrompt,
			phaseEventGameMasterExtractionPrompt: loadedPrompts.phaseEventGameMasterExtractionPrompt,
		},
		{
			currentScene: String(sceneNumber),
			story: {
				storyId: story.id,
				storyName: story.name,
				actLine: {
					...actLine,
					plotMode,
					currentActPhase,
					actPhaseBoundaries,
					lastPlotGeneration: null,
					actNumber,
					currentActPhaseLengthEstimate: null,
					currentScene: sceneNumber,
				},
			},
			context,
		}
	);

	const trackPhase: TrackPhase = (_phaseName, result) => result.state;
	let state: PipelineState = { editorOutput };
	const gmResult = await executeGmPhase(ctx, state);
	state = await trackPhase('GAME_MASTER', gmResult, providerConfigs.gameMaster?.model);
	state = await runGmTemplateFitter(ctx, state, trackPhase);

	return state.gameData ?? null;
}

export interface GameDataRegenerationContext {
	story: Story;
	actLine: ActLineMeta;
	actNumber: number;
	worldContent: string;
	actPlot: string;
	sceneNumber: number;
	/** The message's rendered editor output — the scene the GM re-derives game data from. */
	editorOutput: string;
}

/**
 * Regenerate GameData for an existing message when enriching a forked message with turnOfEvents.
 * Builds a minimal, reduced-scope PipelineContext (world + act plot only — no scene history,
 * character profiles, or summaries) and delegates to the shared GM regeneration core.
 */
export async function regenerateGameData(params: GameDataRegenerationContext): Promise<GameDataFields | null> {
	const { story, actLine, actNumber, worldContent, actPlot, sceneNumber, editorOutput } = params;
	const context: PipelineContext = {
		worldContent,
		actPlot,
		previousActSummaries: [],
		summarizationPoint: 0,
		characterProfiles: [],
		actSummaryAtSP: '',
		scenesSections: [],
	};
	return runGameMasterRegeneration({
		story,
		actLine,
		actNumber,
		sceneNumber,
		editorOutput,
		context,
		abortSignal: new AbortController().signal,
	});
}
