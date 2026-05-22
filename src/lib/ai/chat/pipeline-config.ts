import type { PipelineProviderConfigs } from '../pipeline/types';
import {
	getEditorProviderConfig,
	getGameMasterProviderConfig,
	getMainProviderConfig,
	getMinorTaskAgentProviderConfig,
	getPlotPlannerProviderConfig,
	getReviewerProviderConfig,
	getSummarizerProviderConfig,
	getWriterProviderConfig,
} from '$lib/stores/settings.svelte';

/** Build provider configs for all pipeline roles, falling back to main config */
export function buildPipelineProviderConfigs(): PipelineProviderConfigs {
	return {
		plotPlanner: getPlotPlannerProviderConfig() ?? getMainProviderConfig(),
		writer: getWriterProviderConfig() ?? getMainProviderConfig(),
		reviewer: getReviewerProviderConfig() ?? getMainProviderConfig(),
		editor: getEditorProviderConfig() ?? getMainProviderConfig(),
		gameMaster: getGameMasterProviderConfig() ?? getMainProviderConfig(),
		summarizer: getSummarizerProviderConfig() ?? getMainProviderConfig(),
		minorTaskAgent: getMinorTaskAgentProviderConfig() ?? getMainProviderConfig(),
	};
}
