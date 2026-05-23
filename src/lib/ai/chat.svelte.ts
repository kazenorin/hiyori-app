import type { ActLineMeta } from '$lib/db/act-lines';
import * as dbActLines from '$lib/db/act-lines';
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
import { getActiveActPlotContent, getActiveDirectorNotesText, getActiveWorldContent } from '$lib/stores/stories.svelte';
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
import type { NarrativeVariables, PlotMode } from './narrative-types';
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
import type { PostEditorContext } from './pipeline/message-builder';

export type { UIMessage };

interface RequestContext {
	actLineId: string;
	message?: string;
	mainConfig: ProviderConfig;
	story: Story;
	actLine: ActLineMeta;
	previousSceneNumber: number;
	previousNarrativeVariables: NarrativeVariables | undefined;
}

let messages = $state<UIMessage[]>([]);
let isStreaming = $state(false);
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
	if (!mainConfig?.apiKey) {
		error = 'Please configure your API key in Settings.';
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
	pendingAsyncPhases = null;
}

export async function sendMessage(actLineId: string, message: string): Promise<void> {
	if (message.trim().length === 0) {
		await log.warn('send-message', 'Called with no message body.');
		return;
	}
	const mainConfig = requireMainConfig();
	const story = await dbActLines.getStoryForActLine(actLineId);
	const actLine = await requireActLine(actLineId);
	error = null;
	const requestContext: RequestContext = {
		actLineId,
		message,
		mainConfig,
		story,
		actLine,
		previousSceneNumber: findLastNonNullSceneNumber(messages) ?? 0,
		previousNarrativeVariables: getPreviousNarrativeMessage(messages),
	};
	return executeNarrativeRequest(requestContext);
}

/**
 * Send the narration template as a hidden message.
 * The narration message is never persisted or shown in the UI.
 * Only the assistant's response (the opening narrative) is persisted and displayed.
 */
export async function sendInitialNarration(actLineId: string): Promise<void> {
	setMessages([]);
	const mainConfig = requireMainConfig();
	const story = await dbActLines.getStoryForActLine(actLineId);
	const actLine = await requireActLine(actLineId);
	error = null;
	const requestContext: RequestContext = {
		actLineId,
		mainConfig,
		story,
		actLine,
		previousSceneNumber: 0,
		previousNarrativeVariables: undefined,
	};
	return executeNarrativeRequest(requestContext);
}

function updateMessageMetadataByIndex(result: PipelineResult, messageIdx: number) {
	const updatedMetadata = updateMetaData(result.aggregatedMetadata, result.phases);
	setMessageByIndex(messageIdx, {
		...getMessageByIndex(messageIdx),
		...(updatedMetadata && { metadata: updatedMetadata }),
	});
}

async function executeNarrativeRequest(requestContext: RequestContext): Promise<void> {
	await awaitPendingAsyncPhases('send-message', true);

	const { actLineId, mainConfig, story, actLine, previousNarrativeVariables, previousSceneNumber, message } = requestContext;
	const nextSceneNumber = previousSceneNumber + 1;

	const newMessagesCount = await prepareNewMessages(actLineId, previousSceneNumber, nextSceneNumber, message);
	const playerContext = getPlayerContext(getMessages());
	const messageIdx = getLatestMessageIndex();

	function getCurrentMessage(): UIMessage {
		return getMessageByIndex(messageIdx);
	}

	function setCurrentMessage(message: UIMessage) {
		setMessageByIndex(messageIdx, message);
	}

	try {
		const worldContent = getActiveWorldContent() ?? '';
		const actPlot = getActiveActPlotContent() ?? '';
		const actSummary = getLatestActSummary(previousSceneNumber);
		const plotMode = actLine.plotMode ?? getDefaultPlotMode();
		const previousScenePlot = getScenePlotForScene(previousSceneNumber, plotMode);
		const templateReplacements = { sceneNumber: String(nextSceneNumber) };
		const targetWordCount = settings.targetWordCount;

		const pipelineCallbacks = createPipelineCallbacks({
			getCurrentMessage,
			setCurrentMessage,
			templateReplacements,
			onError: (errorMessage) => {
				error = errorMessage;
			},
		});

		isStreaming = true;
		const result = await runPipeline({
			execution: {
				abortSignal: newAbortSignal(),
				callbacks: pipelineCallbacks,
			},
			worldContent,
			actPlot,
			actSummary,
			previousNarrativeVariables,
			previousScenePlot,
			player: playerContext,
			story: { storyId: story.id, storyName: story.name, actLine },
			completedScenes: previousSceneNumber,
			directorNotes: isDirectorModeEnabled() ? getActiveDirectorNotesText(previousSceneNumber + 1) : '',
			targetWordCount,
		});

		updateMessageMetadataByIndex(result, messageIdx);

		await Promise.all([
			persistMessage(actLineId, getCurrentMessage()),
			updateLastPlotGeneration(result.phases, actLine, previousSceneNumber),
			logMainChat({ newMessages: getMessages().slice(-newMessagesCount) }),
		]);

		const updatedActLine = await requireActLine(actLineId);
		if (updatedActLine.endedAt !== null) {
			actEnded = true;
		}

		const assistantMessageId = getCurrentMessage().id;
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
					if (err instanceof DOMException && err.name === 'AbortError') {
						await log.warn('send-message', 'Async phases aborted');
					} else {
						await log.error('send-message', 'Async phases failed', err);
					}
				}) ?? null;
	} catch (err: unknown) {
		const result = await handleStreamError(err, getCurrentMessage(), actLineId, getMessages());
		setMessages(result.messages);
		if (result.error) error = result.error;
	} finally {
		isStreaming = false;
		abortController = null;
	}
}

export function stopStreaming(): void {
	abortController?.abort();
}

export async function runEpilogueFlow(actLineId: string): Promise<void> {
	await awaitPendingAsyncPhases('epilogue', true);
	requireMainConfig();
	const story = await dbActLines.getStoryForActLine(actLineId);
	const actLine = await requireActLine(actLineId);
	if (!actLine.endingType) {
		error = 'Cannot run epilogue: no ending type set.';
		return;
	}

	const previousSceneNumber = findLastNonNullSceneNumber(messages) ?? 0;
	const nextSceneNumber = previousSceneNumber + 1;
	const newMessagesCount = await prepareNewMessages(actLineId, previousSceneNumber, nextSceneNumber);
	const messageIdx = getLatestMessageIndex();

	function getCurrentMessage(): UIMessage {
		return getMessageByIndex(messageIdx);
	}

	function setCurrentMessage(message: UIMessage) {
		setMessageByIndex(messageIdx, message);
	}

	try {
		const worldContent = getActiveWorldContent() ?? '';
		const actPlot = getActiveActPlotContent() ?? '';
		const actSummary = getLatestActSummary(previousSceneNumber);
		const previousNarrativeVariables = getPreviousNarrativeMessage(messages);
		const targetWordCount = settings.targetWordCount;

		const pipelineCallbacks = createPipelineCallbacks({
			getCurrentMessage,
			setCurrentMessage,
			templateReplacements: { sceneNumber: String(nextSceneNumber) },
			onError: (errorMessage) => {
				error = errorMessage;
			},
		});

		isStreaming = true;
		const result = await runEpiloguePipeline({
			execution: {
				abortSignal: newAbortSignal(),
				callbacks: pipelineCallbacks,
			},
			worldContent,
			actPlot,
			actSummary,
			previousNarrativeVariables,
			endingType: actLine.endingType,
			story: { storyId: story.id, storyName: story.name, actLine },
			completedScenes: previousSceneNumber,
			targetWordCount,
		});

		updateMessageMetadataByIndex(result, messageIdx);

		await Promise.all([
			persistMessage(actLineId, getCurrentMessage()),
			dbActLines.markEpilogueWritten(actLineId),
			logMainChat({ newMessages: getMessages().slice(-newMessagesCount) }),
		]);

		storyConcluded = true;
	} catch (err: unknown) {
		const result = await handleStreamError(err, getCurrentMessage(), actLineId, getMessages());
		setMessages(result.messages);
		if (result.error) error = result.error;
	} finally {
		isStreaming = false;
		abortController = null;
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
	actEnded = actLine?.endedAt != null;
	storyConcluded = actLine?.epilogueWrittenAt != null;

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
	const needsSummary = !lastAssistant.actSummary;
	const needsGameData = !lastAssistant.variables?.gameData;

	if (!needsSummary && !needsGameData) return;

	const abortController = new AbortController();
	isStreaming = true;
	try {
		if (needsSummary) {
			const story = await dbActLines.getStoryForActLine(actLine.id);
			if (story) {
				await regenerateActSummary(story, messages, lastAssistantIdx, abortController);
			}
		}

		if (needsGameData) {
			await regenerateGameData(actLine, messages, lastAssistantIdx, abortController);
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
	if (!providerConfig?.apiKey) {
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

	const loadedPrompts = await loadPrompts(story.id, story.name);
	const summarizerPrompts: SummarizerPrompts = {
		summarizerPrompt: loadedPrompts.summarizerPrompt,
		summarizerIncrementalPrompt: loadedPrompts.summarizerIncrementalPrompt,
		actSummaryIncrementalTemplate: loadedPrompts.actSummaryIncrementalTemplate,
		characterProfileCompressorPrompt: loadedPrompts.characterProfileCompressorPrompt,
	};

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
			transcript.push({ role: 'assistant' as const, content });
		} else if (msg.role === 'user') {
			transcript.push(msg);
		}
	}
	return transcript;
}

async function regenerateGameData(
	actLine: ActLineMeta,
	messages: UIMessage[],
	assistantIdx: number,
	abortController: AbortController
): Promise<void> {
	const assistantMsg = messages[assistantIdx];
	const providerConfigs = buildPipelineProviderConfigs();
	if (!providerConfigs.gameMaster?.apiKey) {
		await log.warn('regenerate-metadata', 'No GM provider configured, skipping game data regeneration');
		return;
	}

	const gmSystemPrompt = await gameMasterSystemPromptLoader.loadDefault();

	const ctx: PipelineRunContext = buildImportRunContext(
		{ retryCount: 3, backoffIntervalSeconds: 5 },
		abortController.signal,
		createOptionalCallbacks({
			onError: (_phase, err) => {
				log.error('regenerate-metadata', 'GM phase error', err);
			},
		}),
		{ gameMasterSystemPrompt: gmSystemPrompt }
	);

	const plotMode = actLine.plotMode ?? getDefaultPlotMode();
	const previousSceneNumber = assistantMsg.sceneNumber ?? 0;
	const previousScenePlot = getScenePlotForScene(previousSceneNumber, plotMode);

	const postEditorCtx: PostEditorContext = {
		actPlot: getActiveActPlotContent() ?? '',
		actPhase: actLine.actPhase,
		actSummary: _getLatestActSummary(messages),
		previousScenePlot,
		previousNarrativeBody: assistantMsg.variables?.narrativeBody ?? undefined,
		completedScenes: previousSceneNumber,
		player: getPlayerContext(messages),
		previousTurnOfEvents: assistantMsg.variables?.turnOfEvents ?? undefined,
		editorOutput: assistantMsg.content,
		directorNotes: '',
	};

	const trackPhase: TrackPhase = (_phaseName, result) => result.state;
	let state: PipelineState = { currentPhase: null };
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

export async function clearMessages(): Promise<void> {
	await awaitPendingAsyncPhases('clear-messages');
	setMessages([]);
	error = null;
	isStreaming = false;
	actEnded = false;
	storyConcluded = false;
}

export async function regenerateLastResponse(actLineId: string, messageId: string): Promise<void> {
	const currentMessages = [...messages];
	const lastAssistantMsgIdx = currentMessages.findLastIndex((m) => m.role === 'assistant');
	if (lastAssistantMsgIdx === -1) return;

	const targetMessageIdx = currentMessages.findIndex((m) => m.id === messageId);
	if (targetMessageIdx !== lastAssistantMsgIdx) {
		error = 'Message state is stale, reloading messages from database.';
		await loadActLineMessages(actLineId);
		return;
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
		await sendMessage(actLineId, userMessageContent);
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
