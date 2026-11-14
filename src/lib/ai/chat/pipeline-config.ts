import {
	getEditorProviderConfig,
	getGameMasterProviderConfig,
	getMainProviderConfig,
	getMinorTaskAgentProviderConfig,
	getPlotPlannerProviderConfig,
	getReviewerProviderConfig,
	getSummarizerProviderConfig,
	getWriterProviderConfig,
	type ParallelRunMode,
} from '#lib/stores/settings.svelte.ts';
import type { PipelineProviderConfigs } from '../pipeline/types';
import { isLocalOrLanHost } from '#lib/utils/url-security.ts';

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

export type EffectiveParallelRunMode = Exclude<ParallelRunMode, 'auto'>;

/**
 * Auto: different endpoints share no cache or context pool; a local/LAN server may
 * exhaust its context on concurrent runs; the same cloud model shares the Writer's
 * prefix cache, but only when the model matches (caches are per-model).
 */
export function resolveParallelRunMode(mode: ParallelRunMode, configs: PipelineProviderConfigs): EffectiveParallelRunMode {
	if (mode !== 'auto') return mode;
	const { writer, summarizer } = configs;
	if (!writer || !summarizer) return 'parallelAfterWriter';
	if (writer.baseURL !== summarizer.baseURL) return 'parallelWithWriter';
	if (isLocalBaseUrl(writer.baseURL)) return 'singleThreaded';
	return writer.model === summarizer.model ? 'parallelAfterWriter' : 'parallelWithWriter';
}

function isLocalBaseUrl(baseURL: string): boolean {
	try {
		return isLocalOrLanHost(new URL(baseURL).hostname);
	} catch {
		return false;
	}
}
