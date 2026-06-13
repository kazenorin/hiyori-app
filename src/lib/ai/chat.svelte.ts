import { isAbortLikeError } from '$lib/utils/async';
import type { ActLineMeta } from '$lib/db/act-lines';
import * as dbActLines from '$lib/db/act-lines';
import { traceActLineChain } from '$lib/db/acts';
import type { ActLineContext, PostEditorContext } from '$lib/ai/pipeline/types';
import type { Story } from '$lib/db/stories';
import { logMainChat } from '$lib/logging/chat-logger';
import { log } from '$lib/logging/logger';
import {
	getDefaultPlotMode,
	getMainProviderConfig,
	getSummarizerProviderConfig,
	isDirectorModeEnabled,
	isPhraseHighlightingEnabled,
	type ProviderConfig,
	settings,
} from '$lib/stores/settings.svelte';
import { getActiveDirectorNotesText } from '$lib/stores/stories.svelte';
import { ensureActPlot } from '$lib/ai/act-plot';
import { extractImportantPhrases } from './important-phrases-extractor';
import {
	findLastNonNullSceneNumber,
	getCharacterNames as _getCharacterNames,
	getForkSequence as _getForkSequence,
	getLatestActivePlotThreads as _getLatestActivePlotThreads,
	getLatestActSummary as _getLatestActSummary,
	getLatestDecisionContext as _getLatestDecisionContext,
	getLatestDecisions as _getLatestDecisions,
	getPlayerContext,
	getPreviousNarrativeMessage,
	getScenePlotForScene as _getScenePlotForScene,
} from './chat/message-queries';
import { resolveAsyncPhaseMetadata, updateMetaData } from './chat/metadata';
import { createOptionalCallbacks, createPipelineCallbacks } from './chat/pipeline-callbacks';
import {
	backfillImportantPhrases,
	handleStreamError,
	loadActLineMessagesFromDB,
	persistMessage,
	persistUserMessage,
	removeMessagesById,
	removeMessagesFromIndex,
	updateLastPlotGeneration,
	updatePersistentMessageMetadata,
} from './chat/persistence';
import { updateMessageFields } from '$lib/db/messages';
import type { NarrativeVariables, PhaseName, PlotMode } from './narrative-types';
import { emptyVariables } from './narrative-types';
import { runEpiloguePipeline, runPipeline } from './pipeline';
import type { AsyncPhaseResults, PipelineResult, PipelineState } from './pipeline/types';
import type { UIMessage } from './chat/types';
import { generateFullSummary, type SummarizerInput, type SummarizerPrompts } from './pipeline/summarizer';
import { executeGmPhase, type PipelineRunContext, runGmTemplateFitter, type TrackPhase } from './pipeline/runners';
import { buildPipelineProviderConfigs } from './chat/pipeline-config';
import { loadPrompts } from './pipeline/prompt-loader';
import { buildImportRunContext } from '$lib/features/import-world/pipeline-context';
import { gameMasterSystemPromptLoader } from '$lib/fs/prompts';
import { sceneWithNumberLabel } from '$lib/definitions/common-labels';
import { otherDirectorNotesHeader, sectionFormat } from '$lib/definitions/common-headers';
import { setActiveLocale } from '$lib/fs/prompt-loader';
import { loadLocaleStrings, ls } from '$lib/localization';
import { ensureWorldFile } from '$lib/ai/world-generator';

// Re-exported for `+page.svelte` only
export type { UIMessage };

interface RequestContext {
	message?: string;
	mainConfig: ProviderConfig;
	story: Story;
	actLine: ActLineContext;
	previousSceneNumber: number;
	previousNarrativeVariables: NarrativeVariables | undefined;
	rewriteDirectorNote?: string;
}

let messages = $state<UIMessage[]>([]);
let isStreaming = $state(false);
let isProcessingAsync = $state(false);
let isConcludingStory = $state(false);
let error = $state<string | null>(null);
let actEnded = $state(false);
let storyConcluded = $state(false);
let abortController: AbortController | null = null;
let pendingAsyncPhases: Promise<AsyncPhaseResults | void> | null = null;

export function getMessages(): UIMessage[] {
	return messages;
}

export function getIsStreaming(): boolean {
	return isStreaming;
}

export function getIsProcessingAsync(): boolean {
	return isProcessingAsync;
}

export function getIsBusy(): boolean {
	return isStreaming || isProcessingAsync || isConcludingStory;
}

export function getIsConcludingStory(): boolean {
	return isConcludingStory;
}

export function setIsConcludingStory(value: boolean): void {
	isConcludingStory = value;
}

export function getError(): string | null {
	return error;
}

export function getActEnded(): boolean {
	return actEnded;
}

export function getStoryConcluded(): boolean {
	return storyConcluded;
}

// Re-exported query functions (delegate to message-queries with module messages)
export { isUserMessage } from './chat/message-queries';
export function getLatestDecisions(): string[] {
	return _getLatestDecisions(messages);
}
export function getLatestActivePlotThreads(): string[] {
	return _getLatestActivePlotThreads(messages);
}
export function getLatestDecisionContext(): string | null {
	return _getLatestDecisionContext(messages);
}
export function getCharacterNames(): string[] {
	return _getCharacterNames(messages);
}
export async function getForkSequence(actLineId: string, assistantMessageIndex: number): Promise<{ branchSeq: number; name: string }> {
	return _getForkSequence(actLineId, messages, assistantMessageIndex);
}

function getLatestActSummary(minSceneNumber?: number): string {
	return _getLatestActSummary(messages, minSceneNumber);
}
function getScenePlotForScene(sceneNumber: number, plotMode: PlotMode): string {
	return _getScenePlotForScene(messages, sceneNumber, plotMode);
}

function newMessage(role: 'user' | 'assistant', sceneNumber: number): UIMessage {
	return {
		id: crypto.randomUUID(),
		role: role,
		content: '',
		reasoning: '',
		phases: [],
		sceneNumber,
	};
}

function getLatestMessageIndex() {
	return messages.length - 1;
}

function getLastMessageIndexOf(assistantMessageId: string) {
	return messages.findLastIndex((m) => m.id === assistantMessageId);
}

function getMessageByIndex(index: number): UIMessage {
	return messages[index];
}

function setMessageByIndex(index: number, message: UIMessage) {
	messages[index] = message;
}

function setMessages(newMessages: UIMessage[]) {
	messages = newMessages;
}

function requireMainConfig(): ProviderConfig {
	const mainConfig = getMainProviderConfig();
	if (!mainConfig) {
		error = 'Please configure your AI API provider in Settings.';
		throw new Error(error);
	}
	if (!mainConfig?.model) {
		error = 'Please configure a model name in Settings.';
		throw new Error(error);
	}
	return mainConfig;
}

function newAbortSignal() {
	const controller = new AbortController();
	abortController = controller;
	return controller.signal;
}

async function requireActLine(actLineId: string): Promise<ActLineMeta> {
	const actLine = await dbActLines.getActLine(actLineId);
	if (!actLine) {
		error = 'Selected act line no longer exists';
		throw new Error(error);
	}
	return actLine;
}

async function prepareNewMessages(
	actLineId: string,
	previousSceneNumber: number,
	nextSceneNumber: number,
	message?: string
): Promise<number> {
	const responseMessage = newMessage('assistant', nextSceneNumber);
	if (message !== undefined) {
		const userMessage = await persistUserMessage(message, previousSceneNumber, actLineId);
		setMessages([...messages, userMessage, responseMessage]);
		return 2;
	} else {
		setMessages([...messages, responseMessage]);
		return 1;
	}
}

async function awaitPendingAsyncPhases(context: string, throwOnNonAbort = false): Promise<void> {
	if (!pendingAsyncPhases) return;
	try {
		await pendingAsyncPhases;
	} catch (err) {
		if (err instanceof DOMException && err.name === 'AbortError') {
			await log.warn(context, 'Async phases aborted');
		} else if (throwOnNonAbort) {
			throw err;
		} else {
			await log.error(context, 'Async phases failed', err);
		}
	}
}

export async function sendMessage(actLineId: string, message: string, rewriteDirectorNote?: string): Promise<void> {
	if (message.trim().length === 0) {
		await log.warn('send-message', 'Called with no message body.');
		return;
	}
	try {
		isStreaming = true;
		const mainConfig = requireMainConfig();
		const story = await dbActLines.getStoryForActLine(actLineId);
		const actLine = await requireActLine(actLineId);
		const currentActPhase = await dbActLines.getActPhase(actLineId);
		const currentLastPlotGen = await dbActLines.getLastPlotGeneration(actLineId);
		const actNumber = (await dbActLines.getActNumberForActLine(actLineId)) ?? 1;
		error = null;
		const requestContext: RequestContext = {
			message,
			mainConfig,
			story,
			actLine: { ...actLine, currentActPhase, lastPlotGeneration: currentLastPlotGen, actNumber },
			previousSceneNumber: findLastNonNullSceneNumber(messages) ?? 0,
			previousNarrativeVariables: getPreviousNarrativeMessage(messages),
			rewriteDirectorNote,
		};
		return await executeNarrativeRequest(requestContext);
	} finally {
		isStreaming = false;
	}
}

export async function sendInitialNarration(actLineId: string): Promise<void> {
	setMessages([]);
	isStreaming = true;

	try {
		const mainConfig = requireMainConfig();
		const story = await dbActLines.getStoryForActLine(actLineId);
		const actLine = await requireActLine(actLineId);
		const currentActPhase = await dbActLines.getActPhase(actLineId);
		const currentLastPlotGen = await dbActLines.getLastPlotGeneration(actLineId);
		const actNumber = (await dbActLines.getActNumberForActLine(actLineId)) ?? 1;
		error = null;
		const requestContext: RequestContext = {
			mainConfig,
			story,
			actLine: { ...actLine, currentActPhase, lastPlotGeneration: currentLastPlotGen, actNumber },
			previousSceneNumber: 0,
			previousNarrativeVariables: undefined,
		};
		return await executeNarrativeRequest(requestContext);
	} finally {
		isStreaming = false;
	}
}

function updateMessageMetadataByIndex(result: PipelineResult, messageIdx: number) {
	const updatedMetadata = updateMetaData(result.aggregatedMetadata, result.phases);
	setMessageByIndex(messageIdx, {
		...getMessageByIndex(messageIdx),
		...(updatedMetadata && { metadata: updatedMetadata }),
	});
}

function composeDirectorNotes(rewriteNote: string | undefined, targetScene: number): string {
	const existingNotes = isDirectorModeEnabled() ? getActiveDirectorNotesText(targetScene) : '';
	if (!rewriteNote) return existingNotes;
	if (!existingNotes) return rewriteNote;
	return rewriteNote + '\n\n' + sectionFormat(otherDirectorNotesHeader()) + existingNotes;
}

async function executeNarrativeRequest(requestContext: RequestContext): Promise<void> {
	const { mainConfig, story, actLine, previousNarrativeVariables, previousSceneNumber, message } = requestContext;
	const abortSignal = newAbortSignal();

	await Promise.all([awaitPendingAsyncPhases('send-message', true), loadLocaleStrings(story.locale)]);
	setActiveLocale(story.locale);

	const nextSceneNumber = previousSceneNumber + 1;

	const newMessagesCount = await prepareNewMessages(actLine.id, previousSceneNumber, nextSceneNumber, message);
	const playerContext = getPlayerContext(getMessages());
	const messageIdx = getLatestMessageIndex();

	const assistantMessageId = getMessageByIndex(messageIdx).id;
	const assistantSequence = await dbActLines.getNextSequence(actLine.id);
	const assistant = { messageId: assistantMessageId, messageSequence: assistantSequence };

	function getCurrentMessage(): UIMessage {
		return getMessageByIndex(messageIdx);
	}

	function setCurrentMessage(message: UIMessage) {
		setMessageByIndex(messageIdx, message);
	}

	try {
		const worldContent = await ensureWorldFile(story.id, story.name, abortSignal);
		const actPlot = await ensureActPlot({ story, actLine, worldContent, abortSignal });
		const actSummary = getLatestActSummary(previousSceneNumber);
		const plotMode = actLine.plotMode ?? getDefaultPlotMode();
		const previousScenePlot = getScenePlotForScene(previousSceneNumber, plotMode);
		const targetWordCount = settings.targetWordCount;

		const previousActSummaries: { actNumber: number; summary: string }[] = [];
		if (actLine.actNumber > 1) {
			const actLineChain = await traceActLineChain(actLine.id);
			const previousActLines = actLineChain.slice(0, -1);
			for (const entry of previousActLines) {
				const shortSummary = await dbActLines.getActShortSummary(entry.actLineId);
				if (shortSummary) {
					previousActSummaries.push({ actNumber: entry.actNumber, summary: shortSummary });
				}
			}
		}

		const pipelineCallbacks = createPipelineCallbacks({
			getCurrentMessage,
			setCurrentMessage,
			onError: (errorMessage) => {
				error = errorMessage;
			},
		});
		const result = await runPipeline({
			execution: {
				abortSignal,
				callbacks: pipelineCallbacks,
			},
			worldContent,
			actPlot,
			actSummary,
			previousNarrativeVariables,
			previousScenePlot,
			previousActSummaries,
			player: playerContext,
			story: { storyId: story.id, storyName: story.name, actLine },
			assistant,
			completedScenes: previousSceneNumber,
			directorNotes: composeDirectorNotes(requestContext.rewriteDirectorNote, previousSceneNumber + 1),
			targetWordCount,
		});

		updateMessageMetadataByIndex(result, messageIdx);

		await Promise.all([
			persistMessage(actLine.id, getCurrentMessage(), assistantSequence),
			updateLastPlotGeneration(result.phases, actLine.id, assistant, previousSceneNumber),
			logMainChat({ newMessages: getMessages().slice(-newMessagesCount) }),
		]);

		const ended = await dbActLines.isActLineEnded(actLine.id);
		if (ended) {
			actEnded = true;
		}

		pendingAsyncPhases =
			result.asyncPhases
				?.then(async (asyncResults) => {
					const assistantMessageIndex = getLastMessageIndexOf(assistantMessageId);
					if (assistantMessageIndex >= 0) {
						const { updatedMessage, metadataUpdates } = resolveAsyncPhaseMetadata(
							getMessageByIndex(assistantMessageIndex),
							asyncResults,
							mainConfig
						);
						setMessageByIndex(assistantMessageIndex, updatedMessage);
						await updatePersistentMessageMetadata(assistantMessageId, metadataUpdates);
					}
					return asyncResults;
				})
				.catch(async (err) => {
					if (isAbortLikeError(err)) {
						await log.warn('send-message', 'Async phases aborted');
					} else {
						await log.error('send-message', 'Async phases failed', err);
					}
				})
				.finally(() => {
					pendingAsyncPhases = null;
					isProcessingAsync = false;
				}) ?? null;
		isProcessingAsync = !!pendingAsyncPhases;
	} catch (err: unknown) {
		const result = await handleStreamError(err, getCurrentMessage(), actLine.id, getMessages());
		setMessages(result.messages);
		if (result.error) error = result.error;
	} finally {
		abortController = null;
	}
}

export function stopStreaming(): void {
	abortController?.abort();
}

export async function runEpilogueFlow(actLineId: string, rewriteDirectorNote?: string): Promise<void> {
	requireMainConfig();
	const abortSignal = newAbortSignal();
	isConcludingStory = true;
	isStreaming = true;

	const [story, actLine, endingType] = await Promise.all([
		dbActLines.getStoryForActLine(actLineId),
		requireActLine(actLineId),
		dbActLines.getEndingType(actLineId),
		awaitPendingAsyncPhases('epilogue', true),
	]);

	const actNumber = (await dbActLines.getActNumberForActLine(actLineId)) ?? 1;

	if (!endingType) {
		error = 'Cannot run epilogue: no ending type set.';
		return;
	}

	setActiveLocale(story.locale);
	await loadLocaleStrings(story.locale);

	const previousSceneNumber = findLastNonNullSceneNumber(messages) ?? 0;
	const nextSceneNumber = previousSceneNumber + 1;
	const newMessagesCount = await prepareNewMessages(actLineId, previousSceneNumber, nextSceneNumber);
	const messageIdx = getLatestMessageIndex();

	const epilogueMessageId = getMessageByIndex(messageIdx).id;
	const epilogueSequence = await dbActLines.getNextSequence(actLineId);
	const epilogueAssistant = { messageId: epilogueMessageId, messageSequence: epilogueSequence };

	function getCurrentMessage(): UIMessage {
		return getMessageByIndex(messageIdx);
	}

	function setCurrentMessage(message: UIMessage) {
		setMessageByIndex(messageIdx, message);
	}

	try {
		const worldContent = await ensureWorldFile(story.id, story.name, abortSignal);
		const actPlot = await ensureActPlot({ story, actLine, worldContent, abortSignal });
		const actSummary = getLatestActSummary(previousSceneNumber);
		const previousNarrativeVariables = getPreviousNarrativeMessage(messages);
		const targetWordCount = settings.targetWordCount;

		const pipelineCallbacks = createPipelineCallbacks({
			getCurrentMessage,
			setCurrentMessage,
			onError: (errorMessage) => {
				error = errorMessage;
			},
		});
		const result = await runEpiloguePipeline({
			execution: {
				abortSignal: abortSignal,
				callbacks: pipelineCallbacks,
			},
			worldContent,
			actPlot,
			actSummary,
			previousNarrativeVariables,
			previousActSummaries: [],
			endingType,
			story: {
				storyId: story.id,
				storyName: story.name,
				actLine: { ...actLine, currentActPhase: null, lastPlotGeneration: null, actNumber },
			},
			assistant: epilogueAssistant,
			completedScenes: previousSceneNumber,
			directorNotes: composeDirectorNotes(rewriteDirectorNote, previousSceneNumber + 1),
			targetWordCount,
		});

		updateMessageMetadataByIndex(result, messageIdx);

		await Promise.all([
			persistMessage(actLineId, getCurrentMessage(), epilogueSequence),
			dbActLines.recordEpilogueWritten(actLineId, epilogueAssistant),
			logMainChat({ newMessages: getMessages().slice(-newMessagesCount) }),
		]);

		storyConcluded = true;
	} catch (err: unknown) {
		const result = await handleStreamError(err, getCurrentMessage(), actLineId, getMessages());
		setMessages(result.messages);
		if (result.error) error = result.error;
	} finally {
		abortController = null;
		isStreaming = false;
		isConcludingStory = false;
	}
}

export function resetActEnded(): void {
	actEnded = false;
	storyConcluded = false;
}

export async function loadActLineMessages(actLineId: string): Promise<void> {
	setMessages(await loadActLineMessagesFromDB(actLineId));
	error = null;

	const actLine = await dbActLines.getActLine(actLineId);
	actEnded = await dbActLines.isActLineEnded(actLineId);
	storyConcluded = await dbActLines.isEpilogueWritten(actLineId);

	if (actLine) {
		await regenerateMissingMetadata(actLine, messages);
	}

	if (isPhraseHighlightingEnabled()) {
		await backfillImportantPhrases(messages, {
			extract: extractImportantPhrases,
			persist: updatePersistentMessageMetadata,
		});
	}
}

async function regenerateMissingMetadata(actLine: ActLineMeta, messages: UIMessage[]): Promise<void> {
	const lastAssistantIdx = messages.findLastIndex((m) => m.role === 'assistant');
	if (lastAssistantIdx === -1) return;

	const lastAssistant = messages[lastAssistantIdx];
	if (!lastAssistant.content.trim()) return;
	if (await dbActLines.hasEventForMessage(lastAssistant.id, 'epilogue-written')) return;

	const needsSummary = !lastAssistant.actSummary;
	const needsGameData = !lastAssistant.variables?.gameData;

	if (!needsSummary && !needsGameData) return;

	const abortController = new AbortController();
	isStreaming = true;
	try {
		const story = await dbActLines.getStoryForActLine(actLine.id);
		if (!story) return;

		if (needsSummary) {
			await regenerateActSummary(story, messages, lastAssistantIdx, abortController);
		}

		if (needsGameData) {
			await regenerateGameData(story, actLine, messages, lastAssistantIdx, abortController);
		}
	} catch (err) {
		await log.error('regenerate-metadata', 'Failed to regenerate missing metadata', err);
	} finally {
		isStreaming = false;
	}
}

async function regenerateActSummary(
	story: Story,
	messages: UIMessage[],
	assistantIdx: number,
	abortController: AbortController
): Promise<void> {
	const assistantMsg = messages[assistantIdx];
	const providerConfig = getSummarizerProviderConfig();
	if (!providerConfig?.model) {
		await log.warn('regenerate-metadata', 'No summarizer provider configured, skipping act summary regeneration');
		return;
	}

	const completedScenes = assistantMsg.sceneNumber ?? findLastNonNullSceneNumber(messages) ?? 1;
	const transcript = buildTranscriptFromMessages(messages);

	const summarizerInput: SummarizerInput = {
		completedScenes,
		previousNarrativeVariables: assistantMsg.variables,
		providerConfig,
		abortSignal: abortController.signal,
		transcript,
		// following not needed because we have full transcript
		actSummary: '',
		player: undefined,
	};

	const summarizerPrompts: SummarizerPrompts = await loadPrompts(story.id, story.name);
	const result = await generateFullSummary(summarizerInput, summarizerPrompts);

	if (result.serializedSummary) {
		setMessageByIndex(assistantIdx, { ...assistantMsg, actSummary: result.serializedSummary });
		await updatePersistentMessageMetadata(assistantMsg.id, { actSummary: result.serializedSummary });
	}
}

function buildTranscriptFromMessages(messages: UIMessage[]): { role: 'user' | 'assistant'; content: string }[] {
	const transcript: { role: 'user' | 'assistant'; content: string }[] = [];
	for (const msg of messages) {
		if (msg.role === 'assistant') {
			const body = msg.variables?.narrativeBody?.trim();
			const content = body && body.length > 0 ? body : msg.content;
			const prefix = msg.sceneNumber ? sceneWithNumberLabel(msg.sceneNumber) + '\n' : '';
			transcript.push({ role: 'assistant' as const, content: prefix + content });
		} else if (msg.role === 'user') {
			transcript.push({ role: 'user' as const, content: msg.content });
		}
	}
	return transcript;
}

async function regenerateGameData(
	story: Story,
	actLine: ActLineMeta,
	messages: UIMessage[],
	assistantIdx: number,
	abortController: AbortController
): Promise<void> {
	const assistantMsg = messages[assistantIdx];
	const providerConfigs = buildPipelineProviderConfigs();
	if (!providerConfigs.gameMaster?.model) {
		await log.warn('regenerate-metadata', 'No GM provider configured, skipping game data regeneration');
		return;
	}

	const gmSystemPrompt = await gameMasterSystemPromptLoader.loadDefault();

	const ctx: PipelineRunContext = buildImportRunContext(
		{ retryCount: 3, backoffIntervalSeconds: 5 },
		abortController.signal,
		createOptionalCallbacks({
			onError: (_phase: PhaseName, err: unknown) => {
				log.error('regenerate-metadata', 'GM phase error', err);
			},
		}),
		{ gameMasterSystemPrompt: gmSystemPrompt }
	);

	const plotMode = actLine.plotMode ?? getDefaultPlotMode();
	const currentActPhase = await dbActLines.getActPhase(actLine.id);
	const previousSceneNumber = assistantMsg.sceneNumber ?? 0;
	const previousScenePlot = getScenePlotForScene(previousSceneNumber, plotMode);
	const actPlot = await ensureActPlot({ story, actLine });

	const postEditorCtx: PostEditorContext = {
		actPlot,
		actPhase: currentActPhase,
		actSummary: _getLatestActSummary(messages),
		previousScenePlot,
		previousNarrativeBody: assistantMsg.variables?.narrativeBody ?? undefined,
		completedScenes: previousSceneNumber,
		player: getPlayerContext(messages),
		previousTurnOfEvents: assistantMsg.variables?.turnOfEvents ?? undefined,
		editorOutput: assistantMsg.content,
		directorNotes: '',
		previousActSummaries: [],
		actNumber: 1,
	};

	const trackPhase: TrackPhase = (_phaseName, result) => result.state;
	let state: PipelineState = {};
	const gmResult = await executeGmPhase(ctx, state, postEditorCtx);
	state = trackPhase('GAME_MASTER', gmResult, providerConfigs.gameMaster?.model);
	state = await runGmTemplateFitter(ctx, state, trackPhase);

	if (state.gameData) {
		const existingVars = assistantMsg.variables ?? emptyVariables();
		const updatedVars: NarrativeVariables = { ...existingVars, gameData: state.gameData };
		setMessageByIndex(assistantIdx, { ...assistantMsg, variables: updatedVars });
		await updateMessageFields(assistantMsg.id, { variables: JSON.stringify(updatedVars) });
	}
}

export function updateMessageInState(messageId: string, updates: { content?: string; variables?: NarrativeVariables }): void {
	const idx = messages.findIndex((m) => m.id === messageId);
	if (idx === -1) return;
	messages[idx] = {
		...messages[idx],
		...(updates.content !== undefined && { content: updates.content }),
		...(updates.variables !== undefined && { variables: updates.variables }),
	};
}

export async function clearMessages(): Promise<void> {
	await awaitPendingAsyncPhases('clear-messages');
	setMessages([]);
	error = null;
	isStreaming = false;
	actEnded = false;
	storyConcluded = false;
}

export async function regenerateLastResponse(actLineId: string, messageId: string, directorRewriteRequest?: string): Promise<void> {
	const currentMessages = [...messages];
	const lastAssistantMsgIdx = currentMessages.findLastIndex((m) => m.role === 'assistant');
	if (lastAssistantMsgIdx === -1) return;

	const targetMessageIdx = currentMessages.findIndex((m) => m.id === messageId);
	if (targetMessageIdx !== lastAssistantMsgIdx) {
		error = 'Message state is stale, reloading messages from database.';
		await loadActLineMessages(actLineId);
		return;
	}

	const lastAssistantMessage = currentMessages[lastAssistantMsgIdx];

	let rewriteDirectorNote: string | undefined;
	if (directorRewriteRequest) {
		const originalNarrativeBody = lastAssistantMessage.variables?.narrativeBody ?? '';
		const sceneNumber = lastAssistantMessage.sceneNumber ?? 0;
		rewriteDirectorNote = ls('common.descriptions.directorRewriteRequest', {
			sceneNumber: String(sceneNumber),
			originalNarrativeBody,
			directorRewriteRequest,
		});
	}

	// If the assistant message is the first message, regenerate as initial narration
	if (lastAssistantMsgIdx === 0) {
		const removed = await removeMessagesById(actLineId, [messageId]);
		if (!removed) {
			await loadActLineMessages(actLineId);
			return;
		}
		// sendInitialNarration will reset `messages` array
		await sendInitialNarration(actLineId);
		return;
	}

	// If this is an epilogue, remove and re-run the epilogue flow
	if (await dbActLines.isEpilogueWritten(actLineId)) {
		const removed = await removeMessagesById(actLineId, [messageId]);
		if (!removed) {
			await loadActLineMessages(actLineId);
			return;
		}
		await runEpilogueFlow(actLineId, rewriteDirectorNote);
		return;
	}

	// The message before the assistant must be a user message
	const exchangeStartIdx = lastAssistantMsgIdx - 1;
	if (currentMessages[exchangeStartIdx].role !== 'user') {
		await log.warn('regenerate-last-response', 'No user message found before assistant message');
		error = 'Cannot regenerate: no user message found before the assistant response.';
		await loadActLineMessages(actLineId);
		return;
	}

	const userMessageContent = currentMessages[exchangeStartIdx].content;

	const { remaining } = await removeMessagesFromIndex(actLineId, messages, exchangeStartIdx);
	setMessages(remaining);

	// Send the new response first (safe — original data intact on failure)
	try {
		await sendMessage(actLineId, userMessageContent, rewriteDirectorNote);
	} catch (err) {
		await log.error('regenerate-last-response', 'Failed to regenerate response', err);
		await loadActLineMessages(actLineId);
		return;
	}
}

export async function deleteLastExchange(actLineId: string): Promise<void> {
	let lastUserMsgIdx = getLatestMessageIndex();
	while (lastUserMsgIdx >= 0 && messages[lastUserMsgIdx].role !== 'user') {
		lastUserMsgIdx--;
	}

	if (lastUserMsgIdx === -1) return;
	while (lastUserMsgIdx > 0 && messages[lastUserMsgIdx - 1].role === 'user') {
		lastUserMsgIdx--;
	}

	const { success, remaining } = await removeMessagesFromIndex(actLineId, messages, lastUserMsgIdx);
	if (success) setMessages(remaining);
}

/**
 * Error-state fallback: deletes trailing user messages when the last message
 * is a user message (i.e., no assistant response was ever generated).
 * Also removes any consecutive user messages immediately before it.
 */
export async function deleteOrphanedUserMessages(actLineId: string): Promise<void> {
	if (messages.length === 0) return;
	if (messages.at(-1)?.role !== 'user') return;

	let lastUserMsgIdx = getLatestMessageIndex();
	while (lastUserMsgIdx > 0 && messages[lastUserMsgIdx - 1].role === 'user') {
		lastUserMsgIdx--;
	}

	const { success, remaining } = await removeMessagesFromIndex(actLineId, messages, lastUserMsgIdx);
	if (success) setMessages(remaining);
}
