import type { GameDataFields, NarrativeVariables, PhaseName } from './narrative-types';
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

export interface GameDataRegenerationContext {
	story: Story;
	actLine: ActLineMeta;
	actNumber: number;
	worldContent: string;
	actPlot: string;
	sceneNumber: number;
	/** The message's rendered editor output — the scene the GM re-derives game data from. */
	editorOutput: string;
	/** Existing variables, returned to the caller so it can merge the regenerated game data back in. */
	narrativeVariables: NarrativeVariables;
}

/**
 * Regenerate GameData for an existing message by running the real Game Master phase
 * (executeGmPhase + GM template fitter) headlessly through the shared-prefix pipeline, so
 * prompt assembly, plotMode selection, and format fallbacks stay identical to a live run
 * instead of a bespoke reimplementation. Used when enriching a forked message with turnOfEvents.
 *
 * Context is intentionally reduced for this one-off (no prior-scene history, character profiles,
 * act summary, or tools): the GM only needs World Content + Act Plot + the scene's editor output
 * to produce decisions/plot threads.
 */
export async function regenerateGameData(params: GameDataRegenerationContext): Promise<GameDataFields | null> {
	const { story, actLine, actNumber, worldContent, actPlot, sceneNumber, editorOutput } = params;
	const providerConfigs = buildPipelineProviderConfigs();
	if (!providerConfigs.gameMaster?.model) {
		await log.warn('regenerate-metadata', 'No GM provider configured, skipping game data regeneration');
		return null;
	}

	const plotMode = actLine.plotMode ?? getDefaultPlotMode();
	const currentActPhase = await getActPhase(actLine.id);
	const actPhaseBoundaries = await getActPhaseBoundaries(actLine.id);
	const loadedPrompts = await loadPrompts(story.id, story.name);

	const context: PipelineContext = {
		worldContent,
		actPlot,
		previousActSummaries: [],
		actNumber,
		summarizationPoint: 0,
		characterProfiles: [],
		actSummaryAtSP: '',
		scenesSections: [],
	};

	const ctx: PipelineRunContext = buildImportRunContext(
		{ retryCount: 3, backoffIntervalSeconds: 5 },
		new AbortController().signal,
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
