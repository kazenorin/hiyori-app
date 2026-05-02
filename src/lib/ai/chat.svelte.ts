import {
	getMainProviderConfig,
	getMemoryProviderConfig,
	getPlotPlannerProviderConfig,
	getWriterProviderConfig,
	getReviewerProviderConfig,
	getEditorProviderConfig,
	getGameMasterProviderConfig,
	getSummarizerProviderConfig,
	type ProviderConfig,
	settings,
} from '$lib/stores/settings.svelte';
import {
	getActiveStoryId,
	getActiveStoryName,
	getActiveSystemPromptOrDefault,
	getActiveActPlotContent,
	getActiveActSummary,
	getActiveWorldContent,
} from '$lib/stores/stories.svelte';
import type { MessageBase } from '$lib/db/messages';
import type { NarrativeVariables, GameDataFields, UIScenePhase, PhaseName } from './narrative-types';
import * as dbMessages from '$lib/db/messages';
import type { ModelMessage } from 'ai';
import * as dbActLines from '$lib/db/act-lines';
import { logMainChat } from '$lib/logging/chat-logger';
import { buildMetadata, type MessageMetadata } from './chat-stream';
import { runMemoryExtractionPipeline } from './memory-extraction-pipeline';
import { Memory } from '$lib/memory/memory';
import { log } from '$lib/logging/logger';
import { buildTools } from '$lib/ai/tools/tools';
import type { StreamResultMetadata } from '$lib/ai/streaming';
import { getErrorMessage } from '$lib/utils/error-handling';
import { renderFromVariables, variablesToMarkdown, gameDataToMarkdown } from './template-renderer';
import { storyMessageTemplate } from '$lib/fs/view-templates';
import { runPipeline, type PipelineProviderConfigs } from './pipeline';
import type { PipelineState, PipelineCallbacks, PhaseStreamState } from './pipeline-types';
import { getActiveGeneralInstructionsOrDefault } from '$lib/stores/stories.svelte';

export interface UIMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	reasoning?: string;
	metadata?: MessageMetadata;
	sceneNumber?: number;
	variables?: NarrativeVariables;
	phases?: UIScenePhase[];
	actSummary?: string;
}

let messages = $state<UIMessage[]>([]);
let isStreaming = $state(false);
let error = $state<string | null>(null);
let abortController: AbortController | null = null;
let memoryPipelineRunning = $state(false);
let memoryPipelinePromise: Promise<void> | null = null;

export function getMessages(): UIMessage[] {
	return messages;
}

export function isMemoryPipelineRunning(): boolean {
	return memoryPipelineRunning;
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
		sceneNumber: m.sceneNumber,
		variables: m.variables,
		actSummary: m.actSummary,
		// phases is ephemeral — not loaded from DB
	}));
	error = null;
}

export function clearMessages(): void {
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

function getHistory(message: {
	bodyText: string | undefined;
	systemPrompt: string | undefined;
	narrationContent: ModelMessage[] | undefined;
}): MessageBase[] {
	const narrations = message.narrationContent?.length ? message.narrationContent.map(narrowNarrationMessage).filter((m) => m !== null) : [];
	// exclude the first message (current message) to get the existing messages
	const existing = messages.slice(0, -1).map((m) => toHistoryMessage(m));
	return [...narrations, ...existing];
}

function narrowNarrationMessage(msg: ModelMessage): MessageBase | null {
	if (msg.role !== 'user' && msg.role !== 'assistant') return null;
	if (typeof msg.content === 'string') {
		return { role: msg.role, content: msg.content };
	}
	// Handle array content - extract text parts
	if (Array.isArray(msg.content)) {
		const textParts = msg.content.filter((part) => part.type === 'text');
		const text = textParts.map((part) => (part as { type: 'text'; text: string }).text).join('\n');
		return { role: msg.role, content: text };
	}
	return null;
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
	});
	const seq = await dbActLines.getNextSequence(actLineId);
	await dbActLines.addMessageToLine(actLineId, message.id, seq);
}

async function persistUserMessage(
	message: {
		bodyText: string;
		systemPrompt: string | undefined;
		narrationContent: ModelMessage[] | undefined;
	},
	actLineId: string
) {
	const userSceneNumber = findLastNonNullSceneNumber();

	const userMessage: UIMessage = {
		id: crypto.randomUUID(),
		role: 'user',
		content: message.bodyText,
		sceneNumber: userSceneNumber,
	};

	// Persist user message
	await dbMessages.createMessage({
		id: userMessage.id,
		role: userMessage.role,
		content: userMessage.content,
		sceneNumber: userSceneNumber,
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

function runMemoryPipeline(storyId: string | null, actLineId: string, message: UIMessage): void {
	if (!settings.memoryEnabled) return;
	if (!storyId || !actLineId) return;
	memoryPipelineRunning = true;
	memoryPipelinePromise = runMemoryExtractionPipeline(message.content, storyId, actLineId, message.id, message.actSummary ?? undefined)
		.then((result) => log.debug('memory-pipeline', `Processed ${result.charactersProcessed} characters, ${result.memoriesAdded} memories`))
		.catch((err) => log.error('memory-pipeline', 'Pipeline failed', err))
		.finally(() => {
			memoryPipelinePromise = null;
			memoryPipelineRunning = false;
		});
}

function newMessage(role: 'user' | 'assistant'): UIMessage {
	return {
		id: crypto.randomUUID(),
		role: role,
		content: '',
		reasoning: '',
		phases: [],
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

export async function sendMessage(
	actLineId: string,
	message: {
		bodyText: string | undefined;
		systemPrompt: string | undefined;
		narrationContent: ModelMessage[] | undefined;
	}
): Promise<void> {
	const storyIdPromise = dbActLines.getStoryIdForActLine(actLineId);
	if (!message.bodyText && !message.systemPrompt && !message.narrationContent) {
		await log.warn('send-message', 'Called with no body, system prompt, or narration content');
		return;
	}

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

	const responseMessage = newMessage('assistant');
	let newMessagesCount: number = 0;
	if (!!message.bodyText && message.bodyText.trim().length > 0) {
		const userMessage = await persistUserMessage({ ...message, bodyText: message.bodyText }, actLineId);
		messages = [...messages, userMessage, responseMessage];
		newMessagesCount = 2;
	} else {
		messages = [...messages, responseMessage];
		newMessagesCount = 1;
	}

	const playerResponse = getPlayerResponse()

	const messageIdx = messages.length - 1;

	function getCurrentMessage(): UIMessage {
		return messages[messageIdx];
	}

	function setCurrentMessage(message: UIMessage) {
		messages[messageIdx] = message;
	}

	isStreaming = true;
	abortController = new AbortController();
	const storyId = await storyIdPromise;
	const tools = await buildTools(storyId, actLineId);

	try {
		const systemPrompt = message.systemPrompt ?? (await getActiveSystemPromptOrDefault());
		const history = getHistory(message);

		// Await any in-flight memory pipeline before starting a new response
		if (memoryPipelinePromise) {
			await memoryPipelinePromise;
		}

		// Load pipeline context
		const generalInstructions = await getActiveGeneralInstructionsOrDefault();
		const worldContent = getActiveWorldContent() ?? '';
		const actPlot = getActiveActPlotContent() ?? '';
		const actSummary = getLatestActSummary() || getActiveActSummary();
		const previousSceneNumber = findLastNonNullSceneNumber();
		const completedScenes = previousSceneNumber != null ? previousSceneNumber + 1 : 1;
		const templateReplacements = { sceneNumber: String(completedScenes) };
		const targetWordCount = 400;

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
			onPhaseComplete: (phase: PhaseName, pipelineState: PipelineState) => {
				if (phase === 'EDITOR') {
					updateEditorMessage(
						renderContent(pipelineState.editorVariables, pipelineState.editorOutput ?? getCurrentMessage().content),
						pipelineState.editorReasoning,
						pipelineState.editorVariables
					);
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
					actSummary: pipelineState.actSummary ?? current.actSummary,
				});
			},
		};

		const result = await runPipeline({
			providerConfigs: buildPipelineProviderConfigs(),
			generalInstructions,
			worldContent,
			actPlot,
			actSummary,
			playerResponse,
			storyId: storyId ?? undefined,
			storyName: getActiveStoryName() ?? undefined,
			abortSignal: abortController!.signal,
			tools,
			callbacks: pipelineCallbacks,
			memoryRunner: (actSummary: string | undefined) => {
				if (actSummary) {
					setCurrentMessage({ ...getCurrentMessage(), actSummary });
				}
				runMemoryPipeline(storyId, actLineId, getCurrentMessage());
			},
			completedScenes,
			targetWordCount,
		});

		// Update metadata from Editor phase
		if (result.editorMetadata) {
			const editorConfig = getEditorProviderConfig() ?? mainConfig;
			updateMetaData(getCurrentMessage, result.editorMetadata, editorConfig);
		}

		// Scene number already computed as completedScenes above
		const sceneNumber = completedScenes;
		messages[messageIdx] = {
			...messages[messageIdx],
			sceneNumber,
		};

		// Persist with accumulated content
		await Promise.all([
			persistMessage(actLineId, getCurrentMessage()),
			logMainChat({ systemPrompt, newMessages: messages.slice(-newMessagesCount), history }),
		]);
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
	}
}

function getPlayerResponse(): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'user') return messages[i].content
	}
	return undefined;
}

function toHistoryMessage(message: UIMessage): MessageBase {
	if (message.role !== 'assistant') {
		return { role: message.role, content: message.content };
	}

	const vars = message.variables;
	const content = vars ? variablesToMarkdown(vars) : message.content;
	const gd = vars?.gameData;
	// Only include game data in history if it has meaningful content
	const gameDataContent = gd ? '\n' + gameDataToMarkdown(gd) : '';
	return { role: 'assistant', content: content + gameDataContent };
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

/**
 * Send the narration template as a hidden message.
 * The narration message is never persisted or shown in the UI.
 * Only the assistant's response (the opening narrative) is persisted and displayed.
 */
export async function sendInitialNarration(actLineId: string, narrationContent: ModelMessage[], systemPrompt?: string): Promise<void> {
	messages = [];
	return await sendMessage(actLineId, {
		bodyText: undefined,
		systemPrompt: systemPrompt,
		narrationContent: narrationContent,
	});
}

export async function regenerateLastResponse(
	actLineId: string,
	messageId: string,
	narrationContent: ModelMessage[],
	systemPrompt?: string
): Promise<void> {
	const currentMessages = [...messages];
	const lastAssistantMsgIdx = currentMessages.findLastIndex((m) => m.role === 'assistant');
	if (lastAssistantMsgIdx === -1) return;

	const messageIdsToRemove = messages.slice(lastAssistantMsgIdx).map((m) => m.id);

	const targetMessageIdx = currentMessages.findIndex((m) => m.id === messageId);
	if (messageIdsToRemove.length !== 1 || targetMessageIdx !== lastAssistantMsgIdx) {
		error = 'Message state is stale, reloading messages from database.';
		await loadActLineMessages(actLineId);
		return;
	}

	messages = messages.slice(0, lastAssistantMsgIdx);

	// Send new response first (persists to DB), then remove old messages
	try {
		await sendMessage(actLineId, { bodyText: undefined, systemPrompt: systemPrompt, narrationContent: narrationContent });
	} catch (err) {
		await log.error('regenerate-last-response', 'Failed to regenerate response', err);
		await loadActLineMessages(actLineId);
		return;
	}

	// Check the NEW message content (last message in array after sendMessage)
	const newMessage = messages.at(-1);
	if (!newMessage?.content) {
		error = 'Regenerated message is empty, reloading messages from database.';
		await loadActLineMessages(actLineId);
		return;
	}

	let removedIds: string[] = [];
	try {
		removedIds = await dbActLines.removeMessagesFromActLine(actLineId, messageIdsToRemove);
	} catch (err) {
		await log.error('regenerate-last-response', 'Old message removal failed', err);
		await loadActLineMessages(actLineId);
	}

	if (removedIds.length > 0) {
		try {
			await removeMemoriesFromActLine(actLineId, removedIds);
		} catch (err) {
			await log.error('regenerate-last-response', 'Memory cleanup failed', err);
		}
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
	messages = messages.slice(0, lastUserMsgIdx);

	let removedIds: string[] = [];
	try {
		removedIds = await dbActLines.removeMessagesFromActLine(actLineId, messageIdsToRemove);
	} catch (err) {
		await log.error('delete-last-exchange', 'Message removal failed', err);
		return;
	}

	if (removedIds.length > 0) {
		try {
			await removeMemoriesFromActLine(actLineId, removedIds);
		} catch (err) {
			await log.error('delete-last-exchange', 'Memory cleanup failed', err);
		}
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
	messages = messages.slice(0, lastUserMsgIdx);

	let removedIds: string[] = [];
	try {
		removedIds = await dbActLines.removeMessagesFromActLine(actLineId, messageIdsToRemove);
	} catch (err) {
		await log.error('delete-orphaned-user-messages', 'Message removal failed', err);
		return;
	}

	if (removedIds.length > 0) {
		try {
			await removeMemoriesFromActLine(actLineId, removedIds);
		} catch (err) {
			await log.error('delete-orphaned-user-messages', 'Memory cleanup failed', err);
		}
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
		}
	}
}
