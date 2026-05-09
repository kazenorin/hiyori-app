import {
	getEditorProviderConfig,
	getGameMasterProviderConfig,
	getMainProviderConfig,
	getMemoryProviderConfig,
	getPlotPlannerProviderConfig,
	getReviewerProviderConfig,
	getSummarizerProviderConfig,
	getMinorTaskAgentProviderConfig,
	getWriterProviderConfig,
	type ProviderConfig,
	settings,
} from '$lib/stores/settings.svelte';
import { getActiveActPlotContent, getActiveStoryId, getActiveWorldContent } from '$lib/stores/stories.svelte';
import * as dbMessages from '$lib/db/messages';
import type { GameDataFields, NarrativeVariables, PhaseName, UIScenePhase } from './narrative-types';
import * as dbActLines from '$lib/db/act-lines';
import { logMainChat } from '$lib/logging/chat-logger';
import { buildMetadata, type MessageMetadata } from './chat-stream';
import { Memory } from '$lib/memory/memory';
import { log } from '$lib/logging/logger';
import { buildTools } from '$lib/ai/tools/tools';
import type { StreamResultMetadata } from '$lib/ai/streaming';
import { getErrorMessage } from '$lib/utils/error-handling';
import { renderFromVariables } from './template-renderer';
import { storyMessageTemplate } from '$lib/fs/view-templates';
import { type PipelineProviderConfigs, type PlayerContext, runPipeline } from './pipeline';
import type { AsyncPhaseResults, PhaseStreamState, PipelineCallbacks, PipelineState } from './pipeline-types';

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

export async function loadActLineMessages(actLineId: string): Promise<void> {
	const dbMsgs = await dbActLines.getMessagesForLine(actLineId);
	messages = dbMsgs.map((m) => ({
		id: m.id,
		role: m.role,
		content: m.content,
		reasoning: m.reasoning,
		metadata: parseMetadata(m.metadata),
		sceneNumber: m.sceneNumber ?? 0,
		variables: m.variables,
		actSummary: m.actSummary,
		scenePlot: m.scenePlot,
		// phases is ephemeral — not loaded from DB
	}));
	error = null;
}

export async function clearMessages(): Promise<void> {
	if (pendingAsyncPhases) {
		try {
			await pendingAsyncPhases;
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				await log.warn('clear-messages', 'Async phases aborted');
			} else {
				await log.error('clear-messages', 'Async phases failed', err);
			}
		}
		pendingAsyncPhases = null;
	}
	messages = [];
	error = null;
	isStreaming = false;
}

function parseMetadata(raw: string | undefined | null): MessageMetadata | undefined {
	if (!raw) return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

function findLastNonNullSceneNumber(): number | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].sceneNumber != null) return messages[i].sceneNumber;
	}
	return undefined;
}

function getLatestActSummary(): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].actSummary) return messages[i].actSummary!;
	}
	return '';
}

function getLatestScenePlot(): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].scenePlot) return messages[i].scenePlot!;
	}
	return '';
}

async function persistMessage(actLineId: string, message: UIMessage): Promise<void> {
	await dbMessages.createMessage({
		id: message.id,
		role: 'assistant',
		content: message.content,
		reasoning: message.reasoning,
		metadata: message.metadata ? JSON.stringify(message.metadata) : undefined,
		sceneNumber: message.sceneNumber,
		variables: message.variables,
		actSummary: message.actSummary,
		scenePlot: message.scenePlot,
	});
	const seq = await dbActLines.getNextSequence(actLineId);
	await dbActLines.addMessageToLine(actLineId, message.id, seq);
}

async function persistUserMessage(playerResponse: string, sceneNumber: number, actLineId: string) {
	const userMessage: UIMessage = {
		id: crypto.randomUUID(),
		role: 'user',
		content: playerResponse,
		sceneNumber: sceneNumber,
	};

	// Persist user message
	await dbMessages.createMessage({
		id: userMessage.id,
		role: userMessage.role,
		content: userMessage.content,
		sceneNumber: userMessage.sceneNumber,
	});

	const userSeq = await dbActLines.getNextSequence(actLineId);
	await dbActLines.addMessageToLine(actLineId, userMessage.id, userSeq);
	return userMessage;
}

/**
 * Handle errors from streaming: persist partial on abort, remove message on other errors.
 */
async function handleStreamError(err: unknown, messageId: string, actLineId: string): Promise<void> {
	if (err instanceof DOMException && err.name === 'AbortError') {
		// User cancelled — persist partial content (fire and forget)
		const partial = messages.find((m) => m.id === messageId);
		if (partial && partial.content) {
			await persistMessage(actLineId, partial);
		}
		await log.warn('send-message', 'User aborted.');
	} else {
		error = getErrorMessage(err);
		messages = messages.filter((m) => m.id !== messageId);
		await log.error('send-message', error, err);
	}
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

function updateMetaData(getCurrentMessage: () => UIMessage, resultMetadata: StreamResultMetadata | null, providerConfig: ProviderConfig) {
	if (resultMetadata) {
		getCurrentMessage().metadata = buildMetadata(resultMetadata, providerConfig.model);
	}
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

/** Merge Editor variables with GM game data into final NarrativeVariables */
function buildFinalVariables(
	editorVariables: NarrativeVariables | null | undefined,
	gameData: GameDataFields | null | undefined
): NarrativeVariables | undefined {
	if (!editorVariables && !gameData) return undefined;
	return {
		sceneTitle: editorVariables?.sceneTitle ?? null,
		background: editorVariables?.background ?? null,
		narrativeBody: editorVariables?.narrativeBody ?? null,
		cg: editorVariables?.cg ?? null,
		gameData: gameData ?? editorVariables?.gameData ?? null,
	};
}

export async function sendMessage(actLineId: string, message: string, isInitialMessage: boolean = false): Promise<void> {
	if (message.trim().length === 0 && !isInitialMessage) {
		await log.warn('send-message', 'Not initial message and called with no message body.');
		return;
	}

	// Wait for any pending async phases from the previous pipeline run
	if (pendingAsyncPhases) {
		try {
			await pendingAsyncPhases;
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				await log.warn('send-message', 'Previous async phases aborted, proceeding without results.');
			} else {
				throw err;
			}
		}
		pendingAsyncPhases = null;
	}
	const targetWordCount = 400; // TODO: make this configurable via settings
	const storyPromise = dbActLines.getStoryForActLine(actLineId);

	const mainConfig = getMainProviderConfig();
	if (!mainConfig?.apiKey) {
		error = 'Please configure your API key in Settings.';
		return;
	}
	if (!mainConfig?.model) {
		error = 'Please configure a model name in Settings.';
		return;
	}
	error = null;

	// Get previous variables before creating new message
	const previousNarrativeVariables = isInitialMessage ? undefined : getPreviousNarrativeMessage(messages);

	// Scene starts with the assistant's story message, and ends with the player's response.
	const previousSceneNumber = isInitialMessage ? 0 : (findLastNonNullSceneNumber() ?? 0);
	const nextSceneNumber = previousSceneNumber + 1;

	const responseMessage = newMessage('assistant', nextSceneNumber);
	let newMessagesCount: number;
	if (message.trim().length > 0) {
		const userMessage = await persistUserMessage(message, previousSceneNumber, actLineId);
		messages = [...messages, userMessage, responseMessage];
		newMessagesCount = 2;
	} else {
		messages = [...messages, responseMessage];
		newMessagesCount = 1;
	}

	// Get player context after possibly adding new userMessage (Player Response)
	const playerContext = isInitialMessage ? undefined : getPlayerContext(messages);

	const messageIdx = messages.length - 1;

	function getCurrentMessage(): UIMessage {
		return messages[messageIdx];
	}

	function setCurrentMessage(message: UIMessage) {
		messages[messageIdx] = message;
	}

	isStreaming = true;
	abortController = new AbortController();
	const story = await storyPromise;
	const storyId = story.id;
	const tools = await buildTools(storyId, actLineId);

	try {
		// Load pipeline context
		const worldContent = getActiveWorldContent() ?? '';
		const actPlot = getActiveActPlotContent() ?? '';
		const actSummary = getLatestActSummary();
		const previousScenePlot = getLatestScenePlot();
		const templateReplacements = { sceneNumber: String(nextSceneNumber) };

		// Pipeline callback helpers
		const renderContent = (vars: NarrativeVariables | null | undefined, fallback: string): string => {
			if (!vars) return fallback;
			const rendered = renderFromVariables(vars, storyMessageTemplate, templateReplacements);
			return rendered || fallback;
		};

		const updatePhaseInList = (phase: PhaseName, update: Partial<UIScenePhase>): void => {
			const current = getCurrentMessage();
			const phases = (current.phases ?? []).map((p) => (p.phaseName === phase ? { ...p, ...update } : p));
			setCurrentMessage({ ...current, phases });
		};

		const updateEditorMessage = (
			content: string,
			reasoning: string | null | undefined,
			variables: NarrativeVariables | null | undefined
		): void => {
			const current = getCurrentMessage();
			setCurrentMessage({
				...current,
				content,
				reasoning: reasoning ?? current.reasoning,
				variables: variables ?? current.variables,
			});
		};

		const pipelineCallbacks: PipelineCallbacks = {
			onPhaseStart: (phase: PhaseName) => {
				// Editor is shown as main content, not a phase accordion
				if (phase === 'EDITOR') return;
				const current = getCurrentMessage();
				const phases = [...(current.phases ?? []), { phaseName: phase, content: '' }];
				setCurrentMessage({ ...current, phases });
			},
			onPhaseStream: (phase: PhaseName, streamState: PhaseStreamState) => {
				if (phase === 'EDITOR') {
					updateEditorMessage(renderContent(streamState.variables, streamState.content), streamState.reasoning, streamState.variables);
					return;
				}
				updatePhaseInList(phase, { content: streamState.content, reasoning: streamState.reasoning ?? undefined });
			},
			onPhaseRetry: (phase: PhaseName, attempt: number, maxAttempts: number) => {
				// Show retry feedback in the phase content — the next stream will overwrite this
				updatePhaseInList(phase, { content: `Retrying (attempt ${attempt}/${maxAttempts})...` });
			},
			onPhaseComplete: (phase: PhaseName, pipelineState: PipelineState) => {
				if (phase === 'EDITOR') {
					updateEditorMessage(
							renderContent(pipelineState.editorVariables, pipelineState.editorOutput ?? getCurrentMessage().content),
							pipelineState.editorReasoning,
							pipelineState.editorVariables
					);
					return;
				}
				if (phase === 'TEMPLATE_FITTER') {
					// Re-render based on what the fitter updated
					if (pipelineState.editorVariables) {
						updateEditorMessage(
							renderContent(pipelineState.editorVariables, pipelineState.editorOutput ?? getCurrentMessage().content),
							pipelineState.editorReasoning,
							pipelineState.editorVariables
						);
					} else if (pipelineState.gameData) {
						const current = getCurrentMessage();
						const finalVars = buildFinalVariables(current.variables, pipelineState.gameData);
						const content = renderContent(finalVars, current.content);
						setCurrentMessage({ ...current, content, variables: finalVars ?? current.variables });
					}
					return;
				}

				updatePhaseInList(phase, { content: getPhaseContent(phase, pipelineState) });

				// After GM completes, merge game data into variables
				if (phase === 'GAME_MASTER') {
					const current = getCurrentMessage();
					const finalVars = buildFinalVariables(current.variables, pipelineState.gameData);
					const content = renderContent(finalVars, current.content);
					setCurrentMessage({ ...current, content, variables: finalVars ?? current.variables });
				}

				// After Plot Planner completes, store scene plot on the message
				if (phase === 'PLOT_PLANNER' && pipelineState.scenePlot) {
					const current = getCurrentMessage();
					setCurrentMessage({ ...current, scenePlot: pipelineState.scenePlot });
				}
			},
			onError: (phase: PhaseName, err: unknown) => {
				const errorMessage = getErrorMessage(err);
				log.error('pipeline', `Phase ${phase} failed: ${errorMessage}`, err);
				error = errorMessage;
			},
			onAllComplete: (pipelineState: PipelineState) => {
				const current = getCurrentMessage();
				const finalVars = buildFinalVariables(current.variables ?? pipelineState.editorVariables, pipelineState.gameData);
				const content = renderContent(finalVars, pipelineState.editorOutput ?? current.content);
				setCurrentMessage({
					...current,
					content,
					variables: finalVars ?? current.variables,
				});
			},
		};

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
			targetWordCount,
		});

		// Update metadata from Editor phase
		if (result.editorMetadata) {
			const editorConfig = getEditorProviderConfig() ?? mainConfig;
			updateMetaData(getCurrentMessage, result.editorMetadata, editorConfig);
		}

		messages[messageIdx] = {
			...messages[messageIdx],
			sceneNumber: nextSceneNumber,
		};

		// Persist with accumulated content
		await Promise.all([persistMessage(actLineId, getCurrentMessage()), logMainChat({ newMessages: messages.slice(-newMessagesCount) })]);

		// Store async phases
		const assistantMessageId = getCurrentMessage().id;
		pendingAsyncPhases =
			result.asyncPhases
				?.then(async (asyncResults) => {
					if (asyncResults.actSummary !== undefined) {
						await dbMessages.updateMessageFields(assistantMessageId, {
							actSummary: asyncResults.actSummary,
						});
					}
					const targetMessageIdx = messages.findLastIndex((m) => m.id === assistantMessageId);
					if (targetMessageIdx >= 0) {
						const existing = messages[targetMessageIdx];
						const updatedPhases = existing.phases ? [...existing.phases] : [];
						if (asyncResults.actSummary !== undefined) {
							updatedPhases.push({ phaseName: 'SUMMARIZER' as PhaseName, content: asyncResults.actSummary });
						}
						messages[targetMessageIdx] = {
							...existing,
							actSummary: asyncResults.actSummary ?? existing.actSummary,
							phases: updatedPhases,
						};
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
		await handleStreamError(err, responseMessage.id, actLineId);
	} finally {
		isStreaming = false;
		abortController = null;
	}
}

/** Get the final content string for a completed phase from PipelineState */
function getPhaseContent(phase: PhaseName, state: PipelineState): string {
	switch (phase) {
		case 'PLOT_PLANNER':
			return state.scenePlot ?? '';
		case 'WRITER':
			return state.writerOutput ?? '';
		case 'REVIEWER':
			return state.reviewerOutput ?? '';
		case 'EDITOR':
			return state.editorOutput ?? '';
		case 'GAME_MASTER':
			return state.gameMasterOutput ?? '';
		case 'SUMMARIZER':
			return state.actSummary ?? '';
		case 'TEMPLATE_FITTER':
			return '';
	}
}

function getPreviousNarrativeMessage(messages: UIMessage[]): NarrativeVariables | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role === 'assistant' && message.variables?.narrativeBody) return message.variables;
	}
	return undefined;
}

function getPlayerContext(messages: UIMessage[]): PlayerContext | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'user') {
			return { playerResponse: messages[i].content, playerMessageId: messages[i].id };
		}
	}
	return undefined;
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

/**
 * Remove messages from the given index onwards: remove from DB and cleanup memories,
 * then update local state. Returns true if removal succeeded, false if DB removal failed
 * (in which case local state is unchanged).
 */
async function removeMessagesById(actLineId: string, messageIds: string[]): Promise<boolean> {
	let removedIds: string[] = [];
	try {
		removedIds = await dbActLines.removeMessagesFromActLine(actLineId, messageIds);
	} catch (err) {
		await log.error('remove-messages-from-index', 'Message removal failed', err);
		return false;
	}

	if (removedIds.length > 0) {
		try {
			await removeMemoriesFromActLine(actLineId, removedIds);
		} catch (err) {
			await log.error('remove-messages-from-index', 'Memory cleanup failed', err);
		}
	}
	return true;
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

	// Compute IDs before slicing, then remove from DB and update local state
	const messageIdsToRemove = messages.slice(exchangeStartIdx).map((m) => m.id);
	await removeMessagesById(actLineId, messageIdsToRemove);
	messages = messages.slice(0, exchangeStartIdx);

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

	const messageIdsToRemove = messages.slice(lastUserMsgIdx).map((m) => m.id);
	if (await removeMessagesById(actLineId, messageIdsToRemove)) {
		messages = messages.slice(0, lastUserMsgIdx);
	}
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

	const messageIdsToRemove = messages.slice(lastUserMsgIdx).map((m) => m.id);
	if (await removeMessagesById(actLineId, messageIdsToRemove)) {
		messages = messages.slice(0, lastUserMsgIdx);
	}
}

export function isUserMessage(message: UIMessage): boolean {
	return message.role === 'user';
}

export async function getForkSequence(actLineId: string, assistantMessageIndex: number): Promise<{ branchSeq: number; name: string }> {
	const assistantMsg = messages[assistantMessageIndex];
	if (!assistantMsg || assistantMsg.role !== 'assistant') {
		throw new Error('Invalid message: expected assistant message');
	}

	const assistantSeq = await dbActLines.getMessageSequence(actLineId, assistantMsg.id);
	if (assistantSeq === null) throw new Error('Could not find message sequence');

	const preceding = messages.slice(0, assistantMessageIndex);
	const userMsgIdx = preceding.map((m) => m.role).lastIndexOf('user');
	const userMsg = userMsgIdx >= 0 ? messages[userMsgIdx] : null;

	return {
		branchSeq: assistantSeq,
		name: userMsg ? `Fork from "${userMsg.content.slice(0, 30)}${userMsg.content.length > 30 ? '...' : ''}"` : 'New Branch',
	};
}

async function removeMemoriesFromActLine(actLineId: string, messageIdsToRemove: string[]) {
	const storyId = getActiveStoryId();
	if (storyId && settings.memoryEnabled) {
		const config = getMemoryProviderConfig();
		if (config) {
			const memory = new Memory(config);
			await memory.deleteByMessages(storyId, actLineId, messageIdsToRemove);
			await memory.deleteLocationsByMessages(storyId, actLineId, messageIdsToRemove);
			await memory.deleteAliasesByMessages(storyId, actLineId, messageIdsToRemove);
			await memory.deleteInventoryByMessages(storyId, actLineId, messageIdsToRemove);
		}
	}
}
