import { parseCharacterAliases } from '$lib/ai/act-summary-parser';
import { extractImportantPhrases } from './important-phrases-extractor';
import {
	findLastNonNullSceneNumber,
	getLatestActSummary,
	getPlayerContext,
	getPreviousNarrativeMessage,
	getScenePlotForScene,
} from './chat/message-queries';
import {
	backfillImportantPhrases,
	handleStreamError,
	loadActLineMessagesFromDB,
	persistMessage,
	persistUserMessage,
	removeMessagesById,
	removeMessagesFromIndex,
} from './chat/persistence';
import { resolveAsyncPhaseMetadata, updateMetaData } from './chat/metadata';
import { createPipelineCallbacks } from './chat/pipeline-callbacks';
import {
	getDefaultPlotMode,
	getEditorProviderConfig,
	getGameMasterProviderConfig,
	getMainProviderConfig,
	getMinorTaskAgentProviderConfig,
	getPlotPlannerProviderConfig,
	getReevaluationFrequency,
	getReviewerProviderConfig,
	getSummarizerProviderConfig,
	getWriterProviderConfig,
	isDirectorModeEnabled,
	isPhraseHighlightingEnabled,
	settings,
} from '$lib/stores/settings.svelte';
import { getActiveActPlotContent, getActiveDirectorNotesText, getActiveWorldContent } from '$lib/stores/stories.svelte';
import * as dbMessages from '$lib/db/messages';
import type { NarrativeVariables, UIScenePhase } from './narrative-types';
import * as dbActLines from '$lib/db/act-lines';
import { logMainChat } from '$lib/logging/chat-logger';
import type { MessageMetadata } from './chat-stream';
import { log } from '$lib/logging/logger';
import { buildTools } from '$lib/ai/tools/tools';
import { ERR_INVALID_MESSAGE_ROLE, ERR_MESSAGE_SEQUENCE_NOT_FOUND } from '$lib/definitions/error-messages';
import { runPipeline } from './pipeline';
import type { AsyncPhaseResults, PipelineProviderConfigs, PlayerContext } from './pipeline/types';
import type { ProviderConfig } from '$lib/stores/settings.svelte';
import type { Story } from '$lib/db/stories';
import type { ActLineMeta } from '$lib/db/act-lines';

export interface UIMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	reasoning?: string;
	metadata?: MessageMetadata;
	sceneNumber: number;
	variables?: NarrativeVariables;
	phases?: UIScenePhase[];
	actSummary?: string;
	scenePlot?: string;
	importantPhrases?: string[];
}

interface RequestContext {
	actLineId: string;
	message?: string;
	mainConfig: ProviderConfig;
	story: Story;
	actLine: ActLineMeta;
	previousSceneNumber: number;
	previousNarrativeVariables: NarrativeVariables | undefined;
	playerContext: PlayerContext | undefined;
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
function getMessageByIndex(index: number): UIMessage {
	return messages[index];
}

function setMessageByIndex(index: number, message: UIMessage) {
	messages[index] = message;
}

function setMessages(newMessages: UIMessage[]) {
	messages = newMessages;
}

/** Build provider configs for all 6 pipeline roles */
function buildPipelineProviderConfigs(): PipelineProviderConfigs {
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
		playerContext: getPlayerContext(messages),
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
		playerContext: undefined,
	};
	return executeNarrativeRequest(requestContext);
}


async function executeNarrativeRequest(requestContext: RequestContext): Promise<void> {
	await awaitPendingAsyncPhases('send-message', true);

	const actLineId = requestContext.actLineId;
	const mainConfig = requestContext.mainConfig;
	const story = requestContext.story;
	const actLine = requestContext.actLine;

	const previousNarrativeVariables = requestContext.previousNarrativeVariables;
	const previousSceneNumber = requestContext.previousSceneNumber;
	const nextSceneNumber = previousSceneNumber + 1;
	const newMessagesCount = await prepareNewMessages(actLineId, previousSceneNumber, nextSceneNumber, requestContext.message);
	const playerContext = requestContext.playerContext;

	const messageIdx = messages.length - 1;

	function getCurrentMessage(): UIMessage {
		return getMessageByIndex(messageIdx);
	}

	function setCurrentMessage(message: UIMessage) {
		setMessageByIndex(messageIdx, message);
	}

	const tools = await buildTools(story.id, actLine);

	try {
		const worldContent = getActiveWorldContent() ?? '';
		const actPlot = getActiveActPlotContent() ?? '';
		const actSummary = getLatestActSummary(messages);
		const plotMode = actLine.plotMode ?? getDefaultPlotMode();
		const previousScenePlot = getScenePlotForScene(messages, previousSceneNumber, plotMode);
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
		abortController = new AbortController();
		const result = await runPipeline({
			execution: {
				providerConfigs: buildPipelineProviderConfigs(),
				abortSignal: abortController!.signal,
				tools,
				callbacks: pipelineCallbacks,
			},
			worldContent,
			actPlot,
			actSummary,
			previousNarrativeVariables,
			previousScenePlot,
			player: playerContext,
			story: { storyId: story.id, storyName: story.name, actLineId },
			completedScenes: previousSceneNumber,
			directorNotes: isDirectorModeEnabled() ? getActiveDirectorNotesText(previousSceneNumber + 1) : '',
			targetWordCount,
			plotMode: plotMode,
			actPhase: actLine.actPhase ?? undefined,
			lastPlotGeneration: actLine.lastPlotGeneration ?? undefined,
			reevaluationFrequency: getReevaluationFrequency(),
		});

		const updatedMetadata = updateMetaData(result.aggregatedMetadata, result.phases);
		setMessageByIndex(messageIdx, {
			...getMessageByIndex(messageIdx),
			...(updatedMetadata && { metadata: updatedMetadata }),
		});

		await Promise.all([persistMessage(actLineId, getCurrentMessage()), logMainChat({ newMessages: messages.slice(-newMessagesCount) })]);

		if (result.phases?.some((p) => p.phaseName === 'PLOT_PLANNER') && actLine) {
			await dbActLines.updateActLineMetaFields(actLineId, { lastPlotGeneration: previousSceneNumber });
		}

		const assistantMessageId = getCurrentMessage().id;
		const summarizerModel = getSummarizerProviderConfig()?.model ?? mainConfig.model;
		pendingAsyncPhases =
			result.asyncPhases
				?.then(async (asyncResults) => {
					const targetMessageIdx = messages.findLastIndex((m) => m.id === assistantMessageId);
					if (targetMessageIdx >= 0) {
						const { updatedMessage, metadataUpdates } = resolveAsyncPhaseMetadata(
							getMessageByIndex(targetMessageIdx),
							asyncResults,
							summarizerModel
						);
						setMessageByIndex(targetMessageIdx, updatedMessage);

						if (Object.keys(metadataUpdates).length > 0) {
							await dbMessages.updateMessageFields(assistantMessageId, metadataUpdates);
						}
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
		const result = await handleStreamError(err, getCurrentMessage(), actLineId, messages);
		messages = result.messages;
		if (result.error) error = result.error;
	} finally {
		isStreaming = false;
		abortController = null;
	}
}

export function stopStreaming(): void {
	abortController?.abort();
}

export function getLatestDecisions(): string[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'assistant' && messages[i].variables?.gameData?.decisions?.length) {
			return messages[i].variables!.gameData!.decisions;
		}
	}
	return [];
}

export function getLatestActivePlotThreads(): string[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'assistant' && messages[i].variables?.gameData?.activePlotThreads?.length) {
			return messages[i].variables!.gameData!.activePlotThreads;
		}
	}
	return [];
}

export function getLatestDecisionContext(): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'assistant' && messages[i].variables?.gameData?.decisionContext) {
			return messages[i].variables!.gameData!.decisionContext;
		}
	}
	return null;
}

export function getCharacterNames(): string[] {
	const actSummary = getLatestActSummary(messages);
	if (!actSummary) return [];
	const entries = parseCharacterAliases(actSummary);
	const names: string[] = [];
	for (const entry of entries) {
		names.push(entry.characterName);
		names.push(...entry.aliases);
	}
	return names;
}

export async function loadActLineMessages(actLineId: string): Promise<void> {
	setMessages(await loadActLineMessagesFromDB(actLineId));
	error = null;

	if (isPhraseHighlightingEnabled()) {
		await backfillImportantPhrases(messages, {
			extract: extractImportantPhrases,
			persist: (id, text) => dbMessages.updateMessageFields(id, { importantPhrases: text }),
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
	let lastUserMsgIdx = messages.length - 1;
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

	let lastUserMsgIdx = messages.length - 1;
	while (lastUserMsgIdx > 0 && messages[lastUserMsgIdx - 1].role === 'user') {
		lastUserMsgIdx--;
	}

	const { success, remaining } = await removeMessagesFromIndex(actLineId, messages, lastUserMsgIdx);
	if (success) setMessages(remaining);
}

export function isUserMessage(message: UIMessage): boolean {
	return message.role === 'user';
}

export async function getForkSequence(actLineId: string, assistantMessageIndex: number): Promise<{ branchSeq: number; name: string }> {
	const assistantMsg = getMessageByIndex(assistantMessageIndex);
	if (!assistantMsg || assistantMsg.role !== 'assistant') {
		throw new Error(ERR_INVALID_MESSAGE_ROLE);
	}

	const assistantSeq = await dbActLines.getMessageSequence(actLineId, assistantMsg.id);
	if (assistantSeq === null) throw new Error(ERR_MESSAGE_SEQUENCE_NOT_FOUND);

	const sceneTitle = assistantMsg.variables?.sceneTitle;
	const sceneLabel = sceneTitle ? `Scene ${assistantMsg.sceneNumber}: ${sceneTitle}` : `Scene ${assistantMsg.sceneNumber}`;

	return {
		branchSeq: assistantSeq,
		name: `Fork from "${sceneLabel}"`,
	};
}
