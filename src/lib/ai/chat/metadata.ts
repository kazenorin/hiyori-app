import { buildMetadata, toPhaseMetadata, type MessageMetadata, type PhaseMetadata } from '../chat-stream';
import { getSummarizerProviderConfig, type ProviderConfig } from '#lib/stores/settings.svelte.ts';
import type { UIMessage } from './types';
import { BACKGROUND_PHASES, type PhaseName, type UIScenePhase } from '../narrative-types';
import type { BackgroundPhaseResults } from '../pipeline/types';
import type { StreamResultMetadata } from '../streaming';
import { aggregateMetadataFromPhases } from '../pipeline/phase-executor';

export function updateMetaData(
	resultMetadata: StreamResultMetadata | null | undefined,
	phases?: PhaseMetadata[]
): MessageMetadata | undefined {
	if (!resultMetadata) return undefined;
	return buildMetadata(resultMetadata, undefined, phases);
}

/** Merge token fields from a delta into base metadata, appending a new phase entry. */
export function mergeTokenFields(
	base: MessageMetadata | undefined,
	delta: StreamResultMetadata,
	newPhase: PhaseMetadata,
	fallbackModel: string
): MessageMetadata {
	return {
		model: base?.model ?? fallbackModel,
		finishReason: base?.finishReason ?? delta.finishReason,
		inputTokens: (base?.inputTokens ?? 0) + delta.usage.inputTokens,
		outputTokens: (base?.outputTokens ?? 0) + delta.usage.outputTokens,
		totalTokens: (base?.totalTokens ?? 0) + delta.usage.totalTokens,
		cacheReadTokens: (base?.cacheReadTokens ?? 0) + (delta.usage.cacheReadTokens ?? 0) || undefined,
		cacheWriteTokens: (base?.cacheWriteTokens ?? 0) + (delta.usage.cacheWriteTokens ?? 0) || undefined,
		durationMs: (base?.durationMs ?? 0) + delta.durationMs,
		phases: [...(base?.phases ?? []), newPhase],
	};
}

/** Re-append background phase entries already merged during the run (finalize rebuilds from the main aggregate). */
export function mergePreservedBackgroundMetadata(
	mainMetadata: MessageMetadata | undefined,
	existingMetadata: MessageMetadata | undefined
): MessageMetadata | undefined {
	const backgroundEntries = (existingMetadata?.phases ?? []).filter((p) => BACKGROUND_PHASES.includes(p.phaseName as PhaseName));
	let merged = mainMetadata;
	for (const entry of backgroundEntries) {
		const delta = aggregateMetadataFromPhases([entry]);
		if (delta) merged = mergeTokenFields(merged, delta, entry, entry.model);
	}
	return merged;
}

/** Merge compressor metadata into base metadata. Returns base unchanged if no compressor metadata present. */
export function mergeCompressorIntoMetadata(
	base: MessageMetadata | undefined,
	backgroundResults: { compressorMetadata?: StreamResultMetadata },
	existingMetadata: MessageMetadata | undefined,
	summarizerModel: string
): MessageMetadata | undefined {
	if (!backgroundResults.compressorMetadata) return base;
	const cm = backgroundResults.compressorMetadata;
	const compressorPhaseEntry = toPhaseMetadata('CHARACTER_PROFILE_COMPRESSOR', cm, summarizerModel);
	return mergeTokenFields(base ?? existingMetadata, cm, compressorPhaseEntry, summarizerModel);
}

export interface BackgroundPhaseResolution {
	updatedMessage: UIMessage;
	metadataUpdates: { actSummary?: string; metadata?: string };
}

/** Resolve background phase results into an updated message and metadata changes for DB persistence. */
export function resolveBackgroundPhaseMetadata(
	existing: UIMessage,
	backgroundResults: BackgroundPhaseResults,
	mainConfig: ProviderConfig
): BackgroundPhaseResolution {
	const summarizerModel = getSummarizerProviderConfig()?.model ?? mainConfig.model;
	const updatedPhases: UIScenePhase[] = existing.phases ? [...existing.phases] : [];
	const metadataUpdates: { actSummary?: string; metadata?: string } = {};

	if (backgroundResults.actSummary !== undefined) {
		metadataUpdates.actSummary = backgroundResults.actSummary;
	}

	let baseMetadata: MessageMetadata | undefined;

	if (backgroundResults.compressorMetadata) {
		updatedPhases.push({
			phaseName: 'CHARACTER_PROFILE_COMPRESSOR' as PhaseName,
			content: 'compressed',
		});
	}

	const finalMetadata = mergeCompressorIntoMetadata(baseMetadata, backgroundResults, existing.metadata, summarizerModel);
	if (finalMetadata) {
		metadataUpdates.metadata = JSON.stringify(finalMetadata);
	}

	const updatedMessage: UIMessage = {
		...existing,
		actSummary: backgroundResults.actSummary ?? existing.actSummary,
		phases: updatedPhases,
		...(finalMetadata && { metadata: finalMetadata }),
	};

	return { updatedMessage, metadataUpdates };
}
