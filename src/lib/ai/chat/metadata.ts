import { buildMetadata, toPhaseMetadata, type MessageMetadata, type PhaseMetadata } from '../chat-stream';
import type { UIMessage } from '../chat.svelte';
import type { PhaseName, UIScenePhase } from '../narrative-types';
import type { AsyncPhaseResults } from '../pipeline/types';
import type { StreamResultMetadata } from '../streaming';

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

/** Merge compressor metadata into base metadata. Returns base unchanged if no compressor metadata present. */
export function mergeCompressorIntoMetadata(
	base: MessageMetadata | undefined,
	asyncResults: { compressorMetadata?: StreamResultMetadata },
	existingMetadata: MessageMetadata | undefined,
	summarizerModel: string
): MessageMetadata | undefined {
	if (!asyncResults.compressorMetadata) return base;
	const cm = asyncResults.compressorMetadata;
	const compressorPhaseEntry = toPhaseMetadata('CHARACTER_PROFILE_COMPRESSOR', cm, summarizerModel);
	return mergeTokenFields(base ?? existingMetadata, cm, compressorPhaseEntry, summarizerModel);
}

export interface AsyncPhaseResolution {
	updatedMessage: UIMessage;
	metadataUpdates: { actSummary?: string; metadata?: string };
}

/** Resolve async phase results into an updated message and metadata changes for DB persistence. */
export function resolveAsyncPhaseMetadata(
	existing: UIMessage,
	asyncResults: AsyncPhaseResults,
	summarizerModel: string
): AsyncPhaseResolution {
	const updatedPhases: UIScenePhase[] = existing.phases ? [...existing.phases] : [];
	const metadataUpdates: { actSummary?: string; metadata?: string } = {};

	if (asyncResults.actSummary !== undefined) {
		updatedPhases.push({ phaseName: 'SUMMARIZER' as PhaseName, content: asyncResults.actSummary });
		metadataUpdates.actSummary = asyncResults.actSummary;
	}

	let baseMetadata: MessageMetadata | undefined;
	if (asyncResults.summarizerMetadata) {
		const phaseEntry = toPhaseMetadata('SUMMARIZER', asyncResults.summarizerMetadata, summarizerModel);
		baseMetadata = mergeTokenFields(existing.metadata, asyncResults.summarizerMetadata, phaseEntry, summarizerModel);
		metadataUpdates.metadata = JSON.stringify(baseMetadata);
	}

	if (asyncResults.characterProfiles) {
		updatedPhases.push({
			phaseName: 'CHARACTER_PROFILE_COMPRESSOR' as PhaseName,
			content: asyncResults.characterProfiles.map((p) => p.characterName).join(', '),
		});
	}

	const finalMetadata = mergeCompressorIntoMetadata(baseMetadata, asyncResults, existing.metadata, summarizerModel);
	if (finalMetadata !== baseMetadata) {
		metadataUpdates.metadata = JSON.stringify(finalMetadata);
	}

	const updatedMessage: UIMessage = {
		...existing,
		actSummary: asyncResults.actSummary ?? existing.actSummary,
		phases: updatedPhases,
		...(finalMetadata && { metadata: finalMetadata }),
	};

	return { updatedMessage, metadataUpdates };
}
