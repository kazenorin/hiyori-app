import * as dbActLines from '$lib/db/act-lines';
import type { ActLineMeta } from '$lib/db/act-lines';
import type { Story } from '$lib/db/stories';
import { logMainChat } from '$lib/logging/chat-logger';
import { log } from '$lib/logging/logger';
import {
	getDefaultPlotMode,
	getMainProviderConfig,
	isDirectorModeEnabled,
	isPhraseHighlightingEnabled,
	settings,
	type ProviderConfig,
} from '$lib/stores/settings.svelte';
import { getActiveActPlotContent, getActiveDirectorNotesText, getActiveWorldContent } from '$lib/stores/stories.svelte';
import { extractImportantPhrases } from './important-phrases-extractor';
import {
	findLastNonNullSceneNumber,
	getCharacterNames as _getCharacterNames,
	getForkSequence as _getForkSequence,
	getLatestActSummary as _getLatestActSummary,
	getLatestActivePlotThreads as _getLatestActivePlotThreads,
	getLatestDecisions as _getLatestDecisions,
	getLatestDecisionContext as _getLatestDecisionContext,
	getPlayerContext,
	getPreviousNarrativeMessage,
	getScenePlotForScene as _getScenePlotForScene,
} from './chat/message-queries';
import { resolveAsyncPhaseMetadata, updateMetaData } from './chat/metadata';
import { createPipelineCallbacks } from './chat/pipeline-callbacks';
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
import type { NarrativeVariables, PlotMode } from './narrative-types';
import { runPipeline } from './pipeline';
import type { AsyncPhaseResults, PipelineResult } from './pipeline/types';
import type { UIMessage } from './chat/types';
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

function getLatestActSummary(): string {
	return _getLatestActSummary(messages);
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
		const actSummary = getLatestActSummary();
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

export async function loadActLineMessages(actLineId: string): Promise<void> {
	setMessages(await loadActLineMessagesFromDB(actLineId));
	error = null;

	if (isPhraseHighlightingEnabled()) {
		await backfillImportantPhrases(messages, {
			extract: extractImportantPhrases,
			persist: updatePersistentMessageMetadata,
		});
	}
}

export async function clearMessages(): Promise<void> {
	await awaitPendingAsyncPhases('clear-messages');
	setMessages([]);
	error = null;
	isStreaming = false;
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
