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
import type { AsyncPhaseResults, PipelineProviderConfigs } from './pipeline/types';

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

let messages = $state<UIMessage[]>([]);
let isStreaming = $state(false);
let error = $state<string | null>(null);
let abortController: AbortController | null = null;
let pendingAsyncPhases: Promise<AsyncPhaseResults | void> | null = null;

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

export function getMessages(): UIMessage[] {
	return messages;
}

export function getIsStreaming(): boolean {
	return isStreaming;
}

export function getError(): string | null {
	return error;
}

export async function loadActLineMessages(actLineId: string): Promise<void> {
	messages = await loadActLineMessagesFromDB(actLineId);
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
	messages = [];
	error = null;
	isStreaming = false;
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

async function prepareNewMessages(
	actLineId: string,
	message: string,
	previousSceneNumber: number,
	nextSceneNumber: number
): Promise<number> {
	const responseMessage = newMessage('assistant', nextSceneNumber);
	if (message.trim().length > 0) {
		const userMessage = await persistUserMessage(message, previousSceneNumber, actLineId);
		messages = [...messages, userMessage, responseMessage];
		return 2;
	} else {
		messages = [...messages, responseMessage];
		return 1;
	}
}

export async function sendMessage(actLineId: string, message: string, isInitialMessage: boolean = false): Promise<void> {
	if (message.trim().length === 0 && !isInitialMessage) {
		await log.warn('send-message', 'Not initial message and called with no message body.');
		return;
	}

	await awaitPendingAsyncPhases('send-message', true);

	const mainConfig = getMainProviderConfig();
	if (!mainConfig?.apiKey) {
		error = 'Please configure your API key in Settings.';
		return;
	}
	if (!mainConfig?.model) {
		error = 'Please configure a model name in Settings.';
		return;
	}
	const story = await dbActLines.getStoryForActLine(actLineId);
	const actLine = await dbActLines.getActLine(actLineId);
	if (!actLine) {
		error = 'Selected act line no longer exists';
		return;
	}
	error = null;

	// Get previous variables before creating new message
	const previousNarrativeVariables = isInitialMessage ? undefined : getPreviousNarrativeMessage(messages);

	// Scene starts with the assistant's story message, and ends with the player's response.
	const previousSceneNumber = isInitialMessage ? 0 : (findLastNonNullSceneNumber(messages) ?? 0);
	const nextSceneNumber = previousSceneNumber + 1;
	const newMessagesCount = await prepareNewMessages(actLineId, message, previousSceneNumber, nextSceneNumber);

	// Get player context after possibly adding new userMessage (Player Response)
	const playerContext = isInitialMessage ? undefined : getPlayerContext(messages);

	const messageIdx = messages.length - 1;

	function getCurrentMessage(): UIMessage {
		return messages[messageIdx];
	}

	function setCurrentMessage(message: UIMessage) {
		messages[messageIdx] = message;
	}

	const tools = await buildTools(story.id, actLine);

	try {
		// Load pipeline context
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
			completedScenes: previousSceneNumber, // previous scene was just completed by the Player Response
			directorNotes: isDirectorModeEnabled() ? getActiveDirectorNotesText(previousSceneNumber + 1) : '',
			targetWordCount,
			plotMode: plotMode,
			actPhase: actLine.actPhase ?? undefined,
			lastPlotGeneration: actLine.lastPlotGeneration ?? undefined,
			reevaluationFrequency: getReevaluationFrequency(),
		});

		const updatedMetadata = updateMetaData(result.aggregatedMetadata, result.phases);
		messages[messageIdx] = {
			...messages[messageIdx],
			...(updatedMetadata && { metadata: updatedMetadata }),
		};

		// Persist with accumulated content
		await Promise.all([persistMessage(actLineId, getCurrentMessage()), logMainChat({ newMessages: messages.slice(-newMessagesCount) })]);

		// Update lastPlotGeneration if Plot Planner ran this turn.
		// Save completedScenes (previousSceneNumber) so the frequency formula
		// (completedScenes - lastPlotGeneration) >= frequency counts correctly.
		if (result.phases?.some((p) => p.phaseName === 'PLOT_PLANNER') && actLine) {
			await dbActLines.updateActLineMetaFields(actLineId, { lastPlotGeneration: previousSceneNumber });
		}

		// Store async phases
		const assistantMessageId = getCurrentMessage().id;
		const summarizerModel = getSummarizerProviderConfig()?.model ?? mainConfig.model;
		pendingAsyncPhases =
			result.asyncPhases
				?.then(async (asyncResults) => {
					const targetMessageIdx = messages.findLastIndex((m) => m.id === assistantMessageId);
					if (targetMessageIdx >= 0) {
						const { updatedMessage, metadataUpdates } = resolveAsyncPhaseMetadata(
							messages[targetMessageIdx],
							asyncResults,
							summarizerModel
						);
						messages[targetMessageIdx] = updatedMessage;

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

/**
 * Send the narration template as a hidden message.
 * The narration message is never persisted or shown in the UI.
 * Only the assistant's response (the opening narrative) is persisted and displayed.
 */
export async function sendInitialNarration(actLineId: string): Promise<void> {
	messages = [];
	return await sendMessage(actLineId, '', true);
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
	messages = remaining;

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
	if (success) messages = remaining;
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
	if (success) messages = remaining;
}

export function isUserMessage(message: UIMessage): boolean {
	return message.role === 'user';
}

export async function getForkSequence(actLineId: string, assistantMessageIndex: number): Promise<{ branchSeq: number; name: string }> {
	const assistantMsg = messages[assistantMessageIndex];
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
