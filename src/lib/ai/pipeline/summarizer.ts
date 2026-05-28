import type { ProviderConfig } from '$lib/stores/settings.svelte';
import { getSettings } from '$lib/stores/settings.svelte';
import type { MessageBase } from '$lib/db/messages';
import type { NarrativeVariables } from '../narrative-types';
import type { AsyncPhaseResults, CompressorResult, PipelineProviderConfigs, PlayerContext, SummarizerResult } from './types';
import { runNonStreamingPhase } from './phase-executor';
import {
	buildActSummaryTemplate,
	buildSummarizerMessages,
	buildTranscriptSummarizerMessages,
	formatActSummaryForCompressor,
	toUserMessages,
} from './message-builder';
import {
	type ActSummary,
	mergeActSummary,
	parseActSummary,
	parseIncrementalOutput,
	parseProfilesBody,
	serializeActSummary,
} from '../act-summary-parser';
import { actSummaryHeader, summaryHeader } from '$lib/definitions/common-headers';
import { aliasesLabel, locationLabel, sceneWithNumberLabel } from '$lib/definitions/common-labels';
import { goalLabel, relationshipsLabel, stateLabel, voiceLabel } from '$lib/definitions/character-profile-labels';
import {
	actSummaryIncrementalTemplate,
	characterProfilesHeader,
	characterSummariesHeader,
	sceneSummariesHeader,
	summarizerExtractionPromptTemplate,
	summarizerFallbackExtractionPromptTemplate,
} from '$lib/definitions/pipeline-prompts';
import { log } from '$lib/logging/logger';
import { runMemoryExtractionPipeline } from '$lib/features/memory/memory-extraction-pipeline';
import { type LoadedPrompts } from './prompt-loader';

// --- Input interfaces ---

export interface SummarizerInput {
	actSummary: string;
	completedScenes: number;
	previousNarrativeVariables: NarrativeVariables | undefined;
	player: PlayerContext | undefined;
	providerConfig: ProviderConfig | undefined;
	abortSignal: AbortSignal;
	transcript?: { role: 'user' | 'assistant'; content: string }[];
}

export interface SummarizerPrompts {
	summarizerPrompt: string;
	summarizerIncrementalPrompt: string;
	characterProfileCompressorPrompt: string;
}

export interface CharacterProfileCompressorInput {
	actSummary: string;
	completedScenes: number;
	providerConfig: ProviderConfig | undefined;
	abortSignal: AbortSignal;
}

// --- Summarizer functions ---

export async function generateFullSummary(input: SummarizerInput, prompts: SummarizerPrompts): Promise<SummarizerResult> {
	const { providerConfig, abortSignal } = input;

	const actSummaryTemplate = buildActSummaryTemplate();
	const summarizerSystemPrompt = prompts.summarizerPrompt.replaceAll('{actSummaryTemplate}', actSummaryTemplate);

	let summarizerMessages: MessageBase[];

	if (input.transcript && input.transcript.length > 0) {
		summarizerMessages = buildTranscriptSummarizerMessages(input.transcript);
	} else {
		summarizerMessages = buildSummarizerMessages(
			input.actSummary,
			input.previousNarrativeVariables,
			input.completedScenes,
			input.player,
			undefined,
			summarizerExtractionPromptTemplate,
			summarizerFallbackExtractionPromptTemplate
		);
	}

	const { text: rawSummary, metadata } = await runNonStreamingPhase(
		'SUMMARIZER',
		summarizerSystemPrompt,
		summarizerMessages,
		providerConfig,
		abortSignal
	);
	const { completedScenes, previousNarrativeVariables } = input;
	try {
		const parsed = parseActSummary(rawSummary);
		parsed.completedScenes = completedScenes;
		if (previousNarrativeVariables?.turnOfEvents) {
			parsed.turnOfEvents = previousNarrativeVariables.turnOfEvents;
			parsed.turnOfEventsSceneNumber = completedScenes;
			parsed.turnOfEventsSceneTitle = previousNarrativeVariables.sceneTitle ?? '';
		}
		const serializedSummary = serializeActSummary(parsed);
		return { actSummary: parsed, serializedSummary, metadata };
	} catch {
		return { serializedSummary: rawSummary, metadata };
	}
}

async function generateIncrementalSummary(input: SummarizerInput, prompts: SummarizerPrompts): Promise<SummarizerResult> {
	const { actSummary, completedScenes, previousNarrativeVariables } = input;
	const { providerConfig, abortSignal } = input;

	const existingParsed = parseActSummary(actSummary);

	const sceneNumber = String(completedScenes);
	const sceneTitle = previousNarrativeVariables?.sceneTitle ?? '';
	const processedTemplate = actSummaryIncrementalTemplate()
		.replace(/{sceneSummariesHeader}/g, sceneSummariesHeader())
		.replace(/{characterSummariesHeader}/g, characterSummariesHeader())
		.replace(/{sceneWithNumber}/g, sceneWithNumberLabel('{sceneNumber}'))
		.replace(/{locationLabel}/g, locationLabel())
		.replace(/{summaryHeader}/g, summaryHeader())
		.replace(/{aliasesLabel}/g, aliasesLabel())
		.replaceAll('{completedScenes}', sceneNumber)
		.replaceAll('{sceneNumber}', sceneNumber)
		.replaceAll('{sceneTitle}', sceneTitle);

	const incrementalSystemPrompt = prompts.summarizerIncrementalPrompt.replaceAll('{actSummaryTemplate}', processedTemplate);

	const incrementalMessages = buildSummarizerMessages(
		input.actSummary,
		input.previousNarrativeVariables,
		input.completedScenes,
		input.player,
		existingParsed,
		summarizerExtractionPromptTemplate,
		summarizerFallbackExtractionPromptTemplate
	);
	const { text: incrementalRaw, metadata } = await runNonStreamingPhase(
		'SUMMARIZER',
		incrementalSystemPrompt,
		incrementalMessages,
		providerConfig,
		abortSignal
	);

	try {
		const incrementalParsed = parseIncrementalOutput(incrementalRaw);
		const merged = mergeActSummary(existingParsed, incrementalParsed);
		merged.completedScenes = completedScenes;
		if (previousNarrativeVariables?.turnOfEvents) {
			merged.turnOfEvents = previousNarrativeVariables.turnOfEvents;
			merged.turnOfEventsSceneNumber = completedScenes;
			merged.turnOfEventsSceneTitle = previousNarrativeVariables.sceneTitle ?? '';
		}
		const serializedSummary = serializeActSummary(merged);
		return { actSummary: merged, serializedSummary, metadata };
	} catch (err) {
		await log.warn('pipeline', `Incremental act summary parse/merge failed, falling back to full summary: ${err}`);
		return generateFullSummary(input, prompts);
	}
}

/**
 * Run the summarizer sub-pipeline: incremental if an act summary exists, full generation otherwise.
 */
export async function generateSummarizerResult(input: SummarizerInput, prompts: SummarizerPrompts): Promise<SummarizerResult> {
	return input.actSummary ? generateIncrementalSummary(input, prompts) : generateFullSummary(input, prompts);
}

// --- Character profile compressor ---

/**
 * Run the character profile compressor if the interval threshold is met.
 * Returns null if the compressor is disabled or the interval hasn't elapsed.
 */
export async function generateCharacterProfiles(
	newActSummary: ActSummary,
	compressorInput: CharacterProfileCompressorInput,
	prompts: SummarizerPrompts
): Promise<CompressorResult | null> {
	const { providerConfig, abortSignal } = compressorInput;
	const { completedScenes } = compressorInput;

	const settings = getSettings();
	const interval = settings.characterProfileCompressorInterval;
	if (interval <= 0) return null;

	const existingActSummary = parseActSummary(compressorInput.actSummary);
	const lastScene = existingActSummary.characterProfileLastScene ?? 0;

	if (completedScenes - lastScene < interval) return null;

	const compressorSystemPrompt = prompts.characterProfileCompressorPrompt
		.replaceAll('{actSummaryHeader}', actSummaryHeader())
		.replaceAll('{characterProfilesHeader}', characterProfilesHeader())
		.replaceAll('{stateLabel}', stateLabel())
		.replaceAll('{goalLabel}', goalLabel())
		.replaceAll('{relationshipsLabel}', relationshipsLabel())
		.replaceAll('{voiceLabel}', voiceLabel());

	const messages = toUserMessages(formatActSummaryForCompressor(completedScenes, newActSummary));

	const { text: rawProfiles, metadata } = await runNonStreamingPhase(
		'CHARACTER_PROFILE_COMPRESSOR',
		compressorSystemPrompt,
		messages,
		providerConfig,
		abortSignal
	);

	try {
		const profilesResult = parseProfilesBody(rawProfiles);
		if (profilesResult.profiles.length === 0) return null;
		const updatedFullSummary = { ...newActSummary, characterProfiles: profilesResult.profiles, characterProfileLastScene: completedScenes };
		return {
			characterProfiles: profilesResult.profiles,
			characterProfileLastScene: completedScenes,
			metadata,
			actSummary: updatedFullSummary,
			serializedSummary: serializeActSummary(updatedFullSummary),
		};
	} catch (err) {
		await log.warn('pipeline', `Character profile compressor parse failed: ${err}`);
		return null;
	}
}

// --- Async phases (Summarizer → Compressor → Memory) ---

export interface AsyncPhasesContext {
	player: PlayerContext | undefined;
	completedScenes: number;
	actSummary: string;
	previousNarrativeVariables: NarrativeVariables | undefined;
	previousNarrativeBody: string | undefined;
	providerConfigs: PipelineProviderConfigs;
	abortSignal: AbortSignal;
	storyId: string | undefined;
	actLineId: string | undefined;
	loadedPrompts: LoadedPrompts;
}

export async function runAsyncPhases(ctx: AsyncPhasesContext): Promise<AsyncPhaseResults> {
	const {
		player,
		completedScenes,
		actSummary,
		previousNarrativeVariables,
		previousNarrativeBody,
		providerConfigs,
		abortSignal,
		storyId,
		actLineId,
		loadedPrompts,
	} = ctx;
	if (player?.playerResponse && completedScenes > 0) {
		const summarizerInput: SummarizerInput = {
			actSummary,
			completedScenes,
			previousNarrativeVariables,
			player,
			providerConfig: providerConfigs.summarizer,
			abortSignal,
		};
		const summarizerPrompts: SummarizerPrompts = {
			summarizerPrompt: loadedPrompts.summarizerPrompt,
			summarizerIncrementalPrompt: loadedPrompts.summarizerIncrementalPrompt,
			characterProfileCompressorPrompt: loadedPrompts.characterProfileCompressorPrompt,
		};
		const result = await generateSummarizerResult(summarizerInput, summarizerPrompts);

		let compressorResult: CompressorResult | null = null;
		try {
			if (result.actSummary) {
				const compressorInput: CharacterProfileCompressorInput = {
					actSummary,
					completedScenes,
					providerConfig: providerConfigs.summarizer,
					abortSignal,
				};
				compressorResult = await generateCharacterProfiles(result.actSummary, compressorInput, summarizerPrompts);
			}
		} catch (err) {
			await log.warn('pipeline', `Character profile compressor failed: ${err}`);
		}

		const serializedSummary = compressorResult?.serializedSummary ?? result?.serializedSummary;
		const playerMessageId = player.playerMessageId;
		if (previousNarrativeBody && actLineId && playerMessageId && storyId) {
			try {
				await runMemoryExtractionPipeline(previousNarrativeBody, storyId, actLineId, playerMessageId, serializedSummary);
			} catch (err) {
				await log.error('memory-pipeline', 'Memory extraction failed', err);
			}
		}

		return {
			actSummary: serializedSummary,
			summarizerMetadata: result.metadata,
			...(compressorResult
				? {
						characterProfiles: compressorResult.characterProfiles,
						characterProfileLastScene: compressorResult.characterProfileLastScene,
						compressorMetadata: compressorResult.metadata,
					}
				: {}),
		};
	}
	return {};
}
