import type { ProviderConfig } from '#lib/stores/settings.svelte.ts';
import { getSettings, isMemoryAvailable } from '#lib/stores/settings.svelte.ts';
import type { MessageBase } from '#lib/db/messages.ts';
import type { ToolSet } from 'ai';
import type { NarrativeVariables } from '../narrative-types';
import type {
	AssistantContext,
	BackgroundPhaseResults,
	CompressorResult,
	PipelineCallbacks,
	PipelineContext,
	PipelineProviderConfigs,
	PlayerContext,
	ProfileCompressionState,
	SummarizerResult,
} from './types';
import { aggregateMetadata, runNonStreamingPhase } from './phase-executor';
import { emptyCompressionLog, formatProfileUpdateAttempt } from './compression-log';
import { DEFAULT_RETRY_CONFIG, streamWithRetry } from '../chat-stream';
import type { StreamResultMetadata } from '../streaming';
import {
	buildCompactSummarizerMessages,
	buildPhaseMessages,
	buildTranscriptSummarizerMessages,
	formatActSummaryForCompressor,
	formatActSummaryForSummarizer,
	formatExistingProfilesForCompressor,
	substituteActSummaryTemplate,
	toUserMessages,
} from './message-builder';
import { guardToolsForBackgroundPhase } from '#lib/ai/tools/tools.ts';
import { type ActSummary, mergeActSummary, parseActSummary, parseIncrementalOutput, serializeActSummary } from '../act-summary-parser';
import { actSummaryHeader, currentCharacterProfilesHeader } from '#lib/definitions/common-headers.ts';
import {
	actSummaryTemplate,
	applyLayoutSlots,
	resolveSharedSystemPrompt,
	summarizerExtractionPromptTemplate,
	summarizerFallbackExtractionPromptTemplate,
} from '#lib/definitions/pipeline-prompts.ts';
import { isAbortLikeError } from '#lib/utils/async.ts';
import { log } from '#lib/logging/logger.ts';
import { runMemoryExtractionPipeline } from '#lib/features/memory/memory-extraction-pipeline.ts';
import { type LoadedPrompts } from './prompt-loader';
import { getLatestProfilesByActLine } from '#lib/db/character-profiles.ts';
import { getLastCompressionScene, recordCharacterProfileCompression } from '#lib/db/act-lines.ts';

// --- Input interfaces ---

export interface SummarizerInput {
	actSummary: string;
	completedScenes: number;
	previousNarrativeVariables: NarrativeVariables | undefined;
	player: PlayerContext | undefined;
	providerConfig: ProviderConfig | undefined;
	abortSignal: AbortSignal;
	transcript?: { role: 'user' | 'assistant'; content: string }[];
	context?: PipelineContext;
	tools?: ToolSet;
	callbacks?: PipelineCallbacks;
}

export interface SummarizerPrompts {
	summarizerPrompt: string;
	summarizerIncrementalPrompt: string;
	characterProfileCompressorPrompt: string;
	mainChatSystemPrompt: string;
	generalInstructions: string;
}

export interface CharacterProfileCompressorInput {
	actLineId: string;
	completedScenes: number;
	assistant: AssistantContext;
	providerConfig: ProviderConfig | undefined;
	abortSignal: AbortSignal;
	context: PipelineContext;
	tools: ToolSet | undefined;
	compression: ProfileCompressionState;
	callbacks?: PipelineCallbacks;
}

// --- Summarizer functions ---

function requireContext(input: SummarizerInput): PipelineContext {
	if (!input.context) throw new Error('Summarizer pipeline path requires PipelineContext');
	return input.context;
}

async function streamSummaryText(
	input: SummarizerInput,
	systemPrompt: string,
	messages: MessageBase[],
	tools: ToolSet | undefined
): Promise<{ text: string; metadata: StreamResultMetadata }> {
	const accumulator = await streamWithRetry(systemPrompt, messages, {
		retryConfig: DEFAULT_RETRY_CONFIG,
		onProgress: (state) => input.callbacks?.onPhaseStream('SUMMARIZER', state),
		onError: () => {},
		providerConfig: input.providerConfig,
		tools,
		abortSignal: input.abortSignal,
		descriptors: [],
		onRetry: input.callbacks ? (attempt, maxAttempts) => input.callbacks!.onPhaseRetry('SUMMARIZER', attempt, maxAttempts) : undefined,
	});
	const metadata = await accumulator.resultMetadata;
	return { text: accumulator.state.content, metadata };
}

export async function generateFullSummary(input: SummarizerInput, prompts: SummarizerPrompts): Promise<SummarizerResult> {
	const { providerConfig, abortSignal } = input;
	const mode = getSettings().backgroundContextMode;

	const fullTemplate = `# {{actSummaryHeader}}\n\n${actSummaryTemplate()}`;
	const actSummaryTemplateProcessed = substituteActSummaryTemplate(fullTemplate, {
		sceneNumber: '{N}',
		sceneTitle: '[Scene title]',
	});
	// Transcript regeneration keeps the rich wording: its bespoke layout predates both modes.
	const fullRolePrompt = applyLayoutSlots(prompts.summarizerPrompt, input.transcript?.length ? 'rich' : mode).replaceAll(
		'{{actSummaryTemplate}}',
		actSummaryTemplateProcessed
	);
	const sceneTitle = input.previousNarrativeVariables?.sceneTitle ?? '';
	const finalLine = input.previousNarrativeVariables?.narrativeBody
		? summarizerExtractionPromptTemplate(String(input.completedScenes), sceneTitle)
		: summarizerFallbackExtractionPromptTemplate(input.completedScenes);

	let systemPrompt: string;
	let summarizerMessages: MessageBase[];
	let phaseTools: ToolSet | undefined;

	if (input.transcript && input.transcript.length > 0) {
		// Legacy bespoke layout for transcript-based summary regeneration
		// (chat.svelte.ts regenerateMissingMetadata → regenerateActSummary); no cache sharing.
		systemPrompt = fullRolePrompt;
		summarizerMessages = buildTranscriptSummarizerMessages(input.transcript);
		phaseTools = undefined;
	} else if (mode === 'compact') {
		systemPrompt = fullRolePrompt;
		summarizerMessages = buildCompactSummarizerMessages(
			input.actSummary,
			input.previousNarrativeVariables,
			input.completedScenes,
			input.player,
			undefined,
			finalLine
		);
		phaseTools = undefined;
	} else {
		const context = requireContext(input);
		systemPrompt = resolveSharedSystemPrompt(prompts);
		summarizerMessages = buildPhaseMessages(
			context,
			[...formatActSummaryForSummarizer(input.completedScenes, parseActSummary(input.actSummary)), fullRolePrompt],
			finalLine,
			''
		);
		phaseTools = guardToolsForBackgroundPhase(input.tools, 'SUMMARIZER');
	}

	const { text: rawSummary, metadata } = input.transcript?.length
		? await runNonStreamingPhase('SUMMARIZER', systemPrompt, summarizerMessages, providerConfig, abortSignal, phaseTools)
		: await streamSummaryText(input, systemPrompt, summarizerMessages, phaseTools);
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

	const existingParsed = parseActSummary(actSummary);

	const sceneNumber = String(completedScenes);
	const sceneTitle = previousNarrativeVariables?.sceneTitle ?? '';
	const processedTemplate = substituteActSummaryTemplate(actSummaryTemplate(), { sceneNumber, sceneTitle });

	const mode = getSettings().backgroundContextMode;
	const incrementalExtraction = applyLayoutSlots(prompts.summarizerIncrementalPrompt, mode).replaceAll(
		'{{actSummaryTemplate}}',
		processedTemplate
	);
	const finalLine = summarizerExtractionPromptTemplate(sceneNumber, sceneTitle);
	const incrementalMessages =
		mode === 'compact'
			? buildCompactSummarizerMessages(actSummary, previousNarrativeVariables, completedScenes, input.player, existingParsed, finalLine)
			: buildPhaseMessages(
					requireContext(input),
					[...formatActSummaryForSummarizer(completedScenes, existingParsed), incrementalExtraction],
					finalLine,
					''
				);
	const { text: incrementalRaw, metadata } = await streamSummaryText(
		input,
		mode === 'compact' ? incrementalExtraction : resolveSharedSystemPrompt(prompts),
		incrementalMessages,
		mode === 'compact' ? undefined : guardToolsForBackgroundPhase(input.tools, 'SUMMARIZER')
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
		const full = await generateFullSummary(input, prompts);
		return { ...full, metadata: aggregateMetadata(metadata, full.metadata, input.providerConfig?.model) };
	}
}

/**
 * Run the summarizer sub-pipeline: incremental if an act summary exists, full generation otherwise.
 */
export async function generateSummarizerResult(input: SummarizerInput, prompts: SummarizerPrompts): Promise<SummarizerResult> {
	const callbacks = input.callbacks;
	const generate = () => (input.actSummary ? generateIncrementalSummary(input, prompts) : generateFullSummary(input, prompts));
	if (!callbacks) return generate();
	callbacks.onPhaseStart('SUMMARIZER');
	const result = await generate();
	callbacks.onPhaseComplete('SUMMARIZER', { actSummary: result.serializedSummary }, result.metadata);
	return result;
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

	const lastScene = (await getLastCompressionScene(compressorInput.actLineId)) ?? 0;

	if (completedScenes - lastScene < interval) return null;

	const mode = getSettings().backgroundContextMode;
	const compressorPrompt = applyLayoutSlots(prompts.characterProfileCompressorPrompt, mode)
		.replaceAll('{{actSummaryHeader}}', actSummaryHeader())
		.replaceAll('{{currentCharacterProfilesHeader}}', currentCharacterProfilesHeader());

	const existingProfiles = await getLatestProfilesByActLine(compressorInput.actLineId);
	const tail = [...formatActSummaryForCompressor(completedScenes, newActSummary), ...formatExistingProfilesForCompressor(existingProfiles)];
	const messages = mode === 'compact' ? toUserMessages(tail) : buildPhaseMessages(compressorInput.context, tail, compressorPrompt, '');

	compressorInput.compression.newActSummary = newActSummary;
	const callbacks = compressorInput.callbacks;
	const { compression } = compressorInput;
	let toolLog = '';
	let latestReasoning: string | null = null;
	const emitStream = () =>
		callbacks?.onPhaseStream('CHARACTER_PROFILE_COMPRESSOR', { content: toolLog, reasoning: latestReasoning, variables: null });
	if (callbacks) {
		compression.onAttempt = (attempt) => {
			toolLog += (toolLog ? '\n\n' : '') + formatProfileUpdateAttempt(attempt);
			emitStream();
		};
		callbacks.onPhaseStart('CHARACTER_PROFILE_COMPRESSOR');
	}
	let metadata: StreamResultMetadata;
	try {
		const accumulator = await streamWithRetry(mode === 'compact' ? compressorPrompt : resolveSharedSystemPrompt(prompts), messages, {
			retryConfig: DEFAULT_RETRY_CONFIG,
			onProgress: (state) => {
				latestReasoning = state.reasoning;
				emitStream();
			},
			onError: () => {},
			providerConfig,
			abortSignal,
			tools: guardToolsForBackgroundPhase(compressorInput.tools, 'CHARACTER_PROFILE_COMPRESSOR'),
			descriptors: [],
			allowEmptyText: true,
			onRetry: callbacks
				? (attempt, maxAttempts) => callbacks.onPhaseRetry('CHARACTER_PROFILE_COMPRESSOR', attempt, maxAttempts)
				: undefined,
		});
		metadata = await accumulator.resultMetadata;
	} finally {
		compression.onAttempt = undefined;
	}
	callbacks?.onPhaseComplete('CHARACTER_PROFILE_COMPRESSOR', { profileCompressionLog: toolLog || emptyCompressionLog() }, metadata);

	if (compression.successCount > 0 || compression.attemptCount === 0) {
		await recordCharacterProfileCompression(compressorInput.actLineId, compressorInput.assistant, completedScenes);
		await log.info(
			'pipeline',
			`Character profile compression at scene ${completedScenes}: ${compression.successCount} updated, ${compression.attemptCount - compression.successCount} failed`
		);
		return { metadata };
	}
	await log.warn(
		'pipeline',
		`Character profile compression: all ${compression.attemptCount} attempts failed; not recorded, will retry next turn`
	);
	return null;
}

// --- Background phases (Summarizer → Compressor → Memory) ---

export interface BackgroundPhasesContext {
	player: PlayerContext | undefined;
	completedScenes: number;
	actSummary: string;
	previousNarrativeVariables: NarrativeVariables | undefined;
	previousNarrativeBody: string | undefined;
	providerConfigs: PipelineProviderConfigs;
	abortSignal: AbortSignal;
	storyId: string | undefined;
	actLineId: string | undefined;
	assistant: AssistantContext;
	loadedPrompts: LoadedPrompts;
	context: PipelineContext;
	tools: ToolSet | undefined;
	compression: ProfileCompressionState;
	callbacks: PipelineCallbacks;
}

export async function runBackgroundPhases(ctx: BackgroundPhasesContext): Promise<BackgroundPhaseResults> {
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
		assistant,
		loadedPrompts,
		context,
		tools,
		compression,
		callbacks,
	} = ctx;
	if (player?.playerResponse && completedScenes > 0) {
		const summarizerInput: SummarizerInput = {
			actSummary,
			completedScenes,
			previousNarrativeVariables,
			player,
			providerConfig: providerConfigs.summarizer,
			abortSignal,
			context,
			tools,
			callbacks,
		};
		const summarizerPrompts: SummarizerPrompts = {
			summarizerPrompt: loadedPrompts.summarizerPrompt,
			summarizerIncrementalPrompt: loadedPrompts.summarizerIncrementalPrompt,
			characterProfileCompressorPrompt: loadedPrompts.characterProfileCompressorPrompt,
			mainChatSystemPrompt: loadedPrompts.mainChatSystemPrompt,
			generalInstructions: loadedPrompts.generalInstructions,
		};
		let result: SummarizerResult;
		try {
			result = await generateSummarizerResult(summarizerInput, summarizerPrompts);
		} catch (err) {
			callbacks.onPhaseFailed?.('SUMMARIZER');
			if (isAbortLikeError(err)) {
				await log.warn('pipeline', 'Background summarizer aborted');
			} else {
				await log.error('pipeline', 'Background summarizer failed', err);
			}
			return {};
		}

		try {
			if (result.actSummary && actLineId) {
				const compressorInput: CharacterProfileCompressorInput = {
					actLineId,
					completedScenes,
					assistant,
					providerConfig: providerConfigs.summarizer,
					abortSignal,
					context,
					tools,
					compression,
					callbacks,
				};
				await generateCharacterProfiles(result.actSummary, compressorInput, summarizerPrompts);
			}
		} catch (err) {
			callbacks.onPhaseFailed?.('CHARACTER_PROFILE_COMPRESSOR');
			if (isAbortLikeError(err)) {
				await log.warn('pipeline', 'Character profile compressor aborted');
			} else {
				await log.warn('pipeline', `Character profile compressor failed: ${err}`);
			}
		}

		const serializedSummary = result?.serializedSummary;
		const playerMessageId = player.playerMessageId;
		if (previousNarrativeBody && actLineId && playerMessageId && storyId && isMemoryAvailable()) {
			try {
				await runMemoryExtractionPipeline(previousNarrativeBody, storyId, actLineId, playerMessageId, serializedSummary);
			} catch (err) {
				if (isAbortLikeError(err)) {
					await log.warn('memory-pipeline', 'Memory extraction aborted');
				} else {
					await log.error('memory-pipeline', 'Memory extraction failed', err);
				}
			}
		}

		return { actSummary: serializedSummary };
	}
	return {};
}
