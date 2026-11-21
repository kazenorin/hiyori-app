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
	ProfileUpdateInput,
	SummarizerResult,
} from './types';
import { aggregateMetadata, runNonStreamingPhase } from './phase-executor';
import { createCompressionLog } from './compression-log';
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
	getProfileUpdateLabels,
	profileUpdateContract,
	profileUpdateRepairInstructions,
	resolveSharedSystemPrompt,
	summarizerExtractionPromptTemplate,
	summarizerFallbackExtractionPromptTemplate,
	templateFitterSystemPrompt,
} from '#lib/definitions/pipeline-prompts.ts';
import { isAbortLikeError } from '#lib/utils/async.ts';
import { log } from '#lib/logging/logger.ts';
import { t } from '#lib/i18n/index.ts';
import { runMemoryExtractionPipeline } from '#lib/features/memory/memory-extraction-pipeline.ts';
import { type LoadedPrompts } from './prompt-loader';
import { getLatestProfilesByActLine, type CharacterProfileEntity } from '#lib/db/character-profiles.ts';
import { getLastCompressionScene, recordCharacterProfileCompression } from '#lib/db/act-lines.ts';
import { applyCharacterProfileUpdate } from '#lib/ai/tools/update-character-profile.ts';
import { parseProfileUpdates, validateProfileUpdateTargets, type ProfileUpdateBatchResult } from './character-profile-updates';

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
	minorTaskAgentProviderConfig: ProviderConfig | undefined;
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

interface CompletedStage {
	text: string;
	metadata: StreamResultMetadata;
}

/** Bounded terminal decision for one eligible compression; assigned once before any write. */
type CompressionTerminal = { kind: 'markdown'; updates: ProfileUpdateInput[] } | { kind: 'tools' };

const FAILED_FINISH_REASONS = new Set(['length', 'content-filter', 'error', 'tool-calls']);

/**
 * Run the character profile compressor if the interval threshold is met.
 * Returns null if the compressor is disabled or the interval hasn't elapsed.
 */
export async function generateCharacterProfiles(
	newActSummary: ActSummary,
	compressorInput: CharacterProfileCompressorInput,
	prompts: SummarizerPrompts
): Promise<CompressorResult | null> {
	const { providerConfig, minorTaskAgentProviderConfig, abortSignal } = compressorInput;
	const { completedScenes } = compressorInput;

	const settings = getSettings();
	const interval = settings.characterProfileCompressorInterval;
	if (interval <= 0) return null;

	const lastScene = (await getLastCompressionScene(compressorInput.actLineId)) ?? 0;

	if (completedScenes - lastScene < interval) return null;

	const mode = settings.backgroundContextMode;
	const method = settings.characterProfileUpdateMethod;
	const labels = getProfileUpdateLabels();
	const contracts = {
		structuredMarkdown: profileUpdateContract('structuredMarkdown', labels),
		toolCalls: profileUpdateContract('toolCalls', labels),
	};
	const repairInstructions = profileUpdateRepairInstructions(labels);

	const compressorBody = applyLayoutSlots(prompts.characterProfileCompressorPrompt, mode)
		.replaceAll('{{actSummaryHeader}}', actSummaryHeader())
		.replaceAll('{{currentCharacterProfilesHeader}}', currentCharacterProfilesHeader());

	const baselineProfiles = await getLatestProfilesByActLine(compressorInput.actLineId);

	const buildStageRequest = (contract: string, profiles: CharacterProfileEntity[]) => {
		const fullPrompt = `${compressorBody}\n\n${contract}`;
		const tail = [...formatActSummaryForCompressor(completedScenes, newActSummary), ...formatExistingProfilesForCompressor(profiles)];
		const messages = mode === 'compact' ? toUserMessages(tail) : buildPhaseMessages(compressorInput.context, tail, fullPrompt, '');
		return { systemPrompt: mode === 'compact' ? fullPrompt : resolveSharedSystemPrompt(prompts), messages };
	};

	const buildRepairMessages = (raw: string, errors: string[]): MessageBase[] =>
		toUserMessages([contracts.structuredMarkdown, errors.map((error) => `- ${error}`).join('\n'), raw, repairInstructions]);

	const isCancellation = (err: unknown) => abortSignal.aborted || isAbortLikeError(err);

	compressorInput.compression.newActSummary = newActSummary;
	const callbacks = compressorInput.callbacks;
	const { compression } = compressorInput;

	const directTools = method === 'toolCalls';
	const runLog = createCompressionLog(directTools, (key) => t(`pipeline.compressorStages.${key}`));
	let latestReasoning: string | null = null;
	// Last markdown stage body wins (repair replaces generation); kept on tool fallback as rejection evidence.
	let markdownBody = '';

	const emitStream = () =>
		callbacks?.onPhaseStream('CHARACTER_PROFILE_COMPRESSOR', {
			content: markdownBody,
			processedContent: runLog.streamContent(),
			reasoning: latestReasoning,
			variables: null,
		});

	let aggregated: StreamResultMetadata | undefined;
	const accumulate = (stage: CompletedStage, stageProvider: ProviderConfig | undefined) => {
		const merged = aggregateMetadata(aggregated ?? null, stage.metadata, stageProvider?.model);
		// The helper replaces the set with the stage provider; keep every model the stage reported.
		merged.models = new Set([...merged.models, ...stage.metadata.models]);
		aggregated = merged;
	};

	const requestStage = async (
		stageKey: 'generation' | 'repair' | 'tools',
		request: { systemPrompt: string; messages: MessageBase[] },
		stageProvider: ProviderConfig | undefined,
		tools: ToolSet | undefined
	): Promise<CompletedStage> => {
		abortSignal.throwIfAborted();
		runLog.beginStage(stageKey);
		emitStream();
		const isMarkdownStage = stageKey !== 'tools';
		const accumulator = await streamWithRetry(request.systemPrompt, request.messages, {
			retryConfig: DEFAULT_RETRY_CONFIG,
			onProgress: (state) => {
				latestReasoning = state.reasoning;
				if (isMarkdownStage) markdownBody = state.content;
				emitStream();
			},
			onError: () => {},
			providerConfig: stageProvider,
			abortSignal,
			tools,
			descriptors: [],
			allowEmptyText: true,
			onRetry: callbacks
				? (attempt, maxAttempts) => {
						callbacks.onPhaseRetry('CHARACTER_PROFILE_COMPRESSOR', attempt, maxAttempts);
						runLog.addRetry();
						emitStream();
					}
				: undefined,
		});
		const metadata = await accumulator.resultMetadata;
		if (isMarkdownStage) markdownBody = accumulator.state.content;
		emitStream();
		const completed = { text: accumulator.state.content, metadata };
		accumulate(completed, stageProvider);
		return completed;
	};

	const readBatch = async (stage: CompletedStage): Promise<ProfileUpdateBatchResult> => {
		if (FAILED_FINISH_REASONS.has(stage.metadata.finishReason)) {
			return {
				ok: false,
				errors: [`The response did not complete normally (${stage.metadata.finishReason}); the batch may be truncated.`],
			};
		}
		if (!stage.text.trim()) return { ok: false, errors: ['The response body is empty.'] };
		const parsed = parseProfileUpdates(stage.text, labels);
		if (!parsed.ok) return parsed;
		return validateProfileUpdateTargets(compressorInput.actLineId, parsed.updates);
	};

	/** Request failures only: validation, lookup, write and checkpoint failures must escape. */
	const tryMarkdownRequest = async (
		stage: 'generation' | 'repair',
		request: Parameters<typeof requestStage>[1],
		provider: ProviderConfig | undefined
	): Promise<CompletedStage | null> => {
		try {
			return await requestStage(stage, request, provider, undefined);
		} catch (err) {
			if (isCancellation(err)) throw err;
			await log.warn('pipeline', `Character profile markdown ${stage} failed, using tools: ${err}`);
			runLog.addFallbackReason(err instanceof Error ? err.message : String(err));
			return null;
		}
	};

	const selectCompressionTerminal = async (): Promise<CompressionTerminal> => {
		if (method === 'toolCalls') return { kind: 'tools' };

		const generation = await tryMarkdownRequest(
			'generation',
			buildStageRequest(contracts.structuredMarkdown, baselineProfiles),
			providerConfig
		);
		if (!generation) return { kind: 'tools' };

		if (!generation.text.trim()) {
			await log.warn('pipeline', 'Character profile markdown generation returned an empty body, using tools');
			runLog.addFallbackReason(t('pipeline.compressorStages.blankBody'));
			return { kind: 'tools' };
		}

		const batch = await readBatch(generation);
		if (batch.ok) return { kind: 'markdown', updates: batch.updates };

		await log.warn('pipeline', `Character profile markdown rejected: ${batch.errors.join(' ')}`);
		runLog.addFallbackReason(batch.errors.join(' '));
		if (!minorTaskAgentProviderConfig) return { kind: 'tools' };

		const repaired = await tryMarkdownRequest(
			'repair',
			{ systemPrompt: templateFitterSystemPrompt(), messages: buildRepairMessages(generation.text, batch.errors) },
			minorTaskAgentProviderConfig
		);
		if (!repaired) return { kind: 'tools' };

		const repairedBatch = await readBatch(repaired);
		if (repairedBatch.ok) return { kind: 'markdown', updates: repairedBatch.updates };

		await log.warn('pipeline', `Repaired character profile markdown rejected: ${repairedBatch.errors.join(' ')}`);
		runLog.addFallbackReason(repairedBatch.errors.join(' '));
		return { kind: 'tools' };
	};

	let terminalEmitted = false;
	try {
		if (callbacks) {
			compression.onAttempt = (attempt) => {
				runLog.addAttempt(attempt);
				emitStream();
			};
			callbacks.onPhaseStart('CHARACTER_PROFILE_COMPRESSOR');
		}
		const terminal = await selectCompressionTerminal();

		if (terminal.kind === 'markdown') {
			for (const update of terminal.updates) {
				await applyCharacterProfileUpdate(compressorInput.actLineId, compression, update, abortSignal);
			}
		} else {
			const profiles = method === 'toolCalls' ? baselineProfiles : await getLatestProfilesByActLine(compressorInput.actLineId);
			await requestStage(
				'tools',
				buildStageRequest(contracts.toolCalls, profiles),
				providerConfig,
				guardToolsForBackgroundPhase(compressorInput.tools, 'CHARACTER_PROFILE_COMPRESSOR')
			);
		}

		const metadata = aggregated;
		if (!metadata) throw new Error('Character profile compressor completed without request metadata');
		abortSignal.throwIfAborted();
		const shouldRecord = compression.successCount > 0 || compression.attemptCount === 0;
		if (shouldRecord) {
			await recordCharacterProfileCompression(compressorInput.actLineId, compressorInput.assistant, completedScenes);
		}
		terminalEmitted = true;
		callbacks?.onPhaseComplete(
			'CHARACTER_PROFILE_COMPRESSOR',
			{ profileCompressionLog: runLog.committedContent(true), profileMarkdownOutput: markdownBody },
			metadata
		);

		if (shouldRecord) {
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
	} catch (err) {
		if (!terminalEmitted) {
			const cancelled = isCancellation(err);
			runLog.addFailure(cancelled, err instanceof Error ? err.message : String(err));
			callbacks?.onPhaseFailed?.('CHARACTER_PROFILE_COMPRESSOR', {
				profileCompressionLog: runLog.committedContent(false),
				profileMarkdownOutput: markdownBody,
				metadata: aggregated,
			});
		}
		throw err;
	} finally {
		compression.onAttempt = undefined;
	}
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
					minorTaskAgentProviderConfig: providerConfigs.minorTaskAgent,
					abortSignal,
					context,
					tools,
					compression,
					callbacks,
				};
				await generateCharacterProfiles(result.actSummary, compressorInput, summarizerPrompts);
			}
		} catch (err) {
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
