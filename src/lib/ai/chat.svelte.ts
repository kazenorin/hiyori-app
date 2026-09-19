import type { ActLineMeta } from '$lib/db/act-lines';
import * as dbActLines from '$lib/db/act-lines';
import { log } from '$lib/logging/logger';
import { getDefaultPlotMode, getSummarizerProviderConfig, isPhraseHighlightingEnabled } from '$lib/stores/settings.svelte';
import { extractImportantPhrases } from './important-phrases-extractor';
import {
	findLastNonNullSceneNumber,
	getCharacterNames as _getCharacterNames,
	getForkSequence as _getForkSequence,
	getLatestActivePlotThreads as _getLatestActivePlotThreads,
	getLatestDecisionContext as _getLatestDecisionContext,
	getLatestDecisions as _getLatestDecisions,
	getScenePlotForScene as _getScenePlotForScene,
} from './chat/message-queries';
import {
	backfillImportantPhrases,
	loadActLineMessagesFromDB,
	removeMessagesById,
	removeMessagesFromIndex,
	updatePersistentMessageMetadata,
} from './chat/persistence';
import { updateMessageFields } from '$lib/db/messages';
import type { NarrativeVariables, PhaseName } from './narrative-types';
import { emptyVariables } from './narrative-types';
import type { UIMessage } from './chat/types';
import { generateFullSummary, type SummarizerInput, type SummarizerPrompts } from './pipeline/summarizer';
import { executeGmPhase, type PipelineRunContext, runGmTemplateFitter, type TrackPhase } from './pipeline/runners';
import { buildPipelineProviderConfigs } from './chat/pipeline-config';
import { loadPrompts } from './pipeline/prompt-loader';
import { buildImportRunContext } from '$lib/features/import-world/pipeline-context';
import { buildScenesSections } from './pipeline/scenes-builder';
import { sceneWithNumberLabel } from '$lib/definitions/common-labels';
import * as runManager from './chat/run-manager';
import type { InterruptedRunInfo } from './chat/run-manager';
import type { PipelineRunKind } from '$lib/db/pipeline-runs';
import type { PipelineContext, PipelineState } from './pipeline/types';
import { getErrorMessage } from '$lib/utils/error-handling';
import { ensureActPlot } from '$lib/ai/act-plot';
import { ensureWorldFile } from '$lib/ai/world-generator';
import type { Story } from '$lib/db/stories';
import { createOptionalCallbacks } from './chat/pipeline-callbacks';
import { ls } from '$lib/localization';

// Re-exported for `+page.svelte` only
export type { UIMessage };

let messages = $state<UIMessage[]>([]);
let displayedActLineId: string | null = null;
/** Reactive mirror of the displayed line's run state — the run-manager registry itself is not reactive. */
let displayedRunStatus = $state<'running' | null>(null);
let displayedRunKind = $state<PipelineRunKind | null>(null);
let error = $state<string | null>(null);
let actEnded = $state(false);
let storyConcluded = $state(false);
let isConcludingStoryOverride = $state(false);
let isBackfilling = $state(false);
let isAsyncPending = $state(false);
/** Interrupted run awaiting the user's Continue/Discard decision for the displayed line. */
let interruptedRun = $state<InterruptedRunInfo | null>(null);

export function getMessages(): UIMessage[] {
	return messages;
}

/** Re-reads the run registry for the displayed line into reactive state. */
function syncDisplayedRun(): void {
	const session = displayedActLineId ? runManager.getActiveSession(displayedActLineId) : undefined;
	displayedRunStatus = session?.status === 'running' ? 'running' : null;
	displayedRunKind = session?.kind ?? null;
}

export function getIsStreaming(): boolean {
	return displayedRunStatus === 'running' || isBackfilling;
}

export function getIsProcessingAsync(): boolean {
	return isAsyncPending;
}

export function getIsConcludingStory(): boolean {
	return isConcludingStoryOverride || (displayedRunStatus === 'running' && displayedRunKind === 'epilogue');
}

export function setIsConcludingStory(value: boolean): void {
	isConcludingStoryOverride = value;
}

export function getIsBusy(): boolean {
	return getIsStreaming() || getIsProcessingAsync() || getIsConcludingStory() || interruptedRun !== null;
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

export function getInterruptedRun(): InterruptedRunInfo | null {
	return interruptedRun;
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

function setMessages(newMessages: UIMessage[]) {
	messages = newMessages;
}

function mirrorSessionMessage(message: UIMessage): void {
	const idx = messages.findIndex((m) => m.id === message.id);
	if (idx >= 0) {
		messages[idx] = message;
	} else {
		messages = [...messages, message];
	}
}

// --- Run event mirroring: only the displayed act line is reflected in the UI ---

runManager.subscribeRuns((event) => {
	if (event.type === 'async-settled') {
		if (event.actLineId === displayedActLineId) isAsyncPending = false;
		return;
	}
	const { session } = event;
	if (session.actLineId !== displayedActLineId) return;
	syncDisplayedRun();

	if (event.type === 'update') {
		mirrorSessionMessage(session.message);
		return;
	}

	switch (session.status) {
		case 'completed':
			mirrorSessionMessage(session.message);
			isAsyncPending = runManager.isProcessingAsyncPhases(session.actLineId);
			if (event.actEnded) actEnded = true;
			if (event.storyConcluded) storyConcluded = true;
			break;
		case 'interrupted':
		case 'failed': {
			setMessages(messages.filter((m) => m.id !== session.message.id));
			if (session.status === 'failed' && session.error) error = session.error;
			void runManager.getInterruptedRunInfo(session.actLineId).then((info) => {
				if (displayedActLineId === session.actLineId) interruptedRun = info;
			});
			break;
		}
		case 'discarded':
			setMessages(messages.filter((m) => m.id !== session.message.id));
			if (interruptedRun?.record.messageId === session.messageId) interruptedRun = null;
			break;
		default:
			break;
	}
});

export async function sendMessage(actLineId: string, message: string, rewriteDirectorNote?: string): Promise<void> {
	if (message.trim().length === 0) {
		await log.warn('send-message', 'Called with no message body.');
		return;
	}
	displayedActLineId = actLineId;
	displayedRunStatus = 'running';
	displayedRunKind = 'main';
	error = null;
	try {
		const { userMessage, assistantMessage } = await runManager.startMainRun({ actLineId, message, rewriteDirectorNote });
		setMessages(userMessage ? [...messages, userMessage, assistantMessage] : [...messages, assistantMessage]);
		syncDisplayedRun();
	} catch (err) {
		error = getErrorMessage(err);
		syncDisplayedRun();
		await log.error('send-message', 'Failed to start run', err);
	}
}

export async function sendInitialNarration(actLineId: string, rewriteDirectorNote?: string): Promise<void> {
	displayedActLineId = actLineId;
	displayedRunStatus = 'running';
	displayedRunKind = 'main';
	setMessages([]);
	error = null;
	try {
		const { assistantMessage } = await runManager.startMainRun({ actLineId, rewriteDirectorNote });
		setMessages([assistantMessage]);
		syncDisplayedRun();
	} catch (err) {
		error = getErrorMessage(err);
		syncDisplayedRun();
		await log.error('send-message', 'Failed to start initial narration', err);
	}
}

export function stopStreaming(): void {
	if (displayedActLineId) runManager.abortRun(displayedActLineId);
}

/** Continue an interrupted run from its cached phases. */
export async function continueInterruptedRun(): Promise<void> {
	const actLineId = displayedActLineId;
	if (!actLineId || !interruptedRun) return;
	displayedRunStatus = 'running';
	displayedRunKind = interruptedRun.record.kind;
	interruptedRun = null;
	error = null;
	try {
		const draftMessage = await runManager.resumeInterruptedRun(actLineId);
		if (draftMessage) setMessages([...messages, draftMessage]);
		// Resume may be a no-op (stale cache auto-discarded) — re-read the registry either way.
		syncDisplayedRun();
	} catch (err) {
		error = getErrorMessage(err);
		syncDisplayedRun();
		// The cache row is still there — keep offering Continue/Discard.
		interruptedRun = await runManager.getInterruptedRunInfo(actLineId);
		await log.error('resume-run', 'Failed to resume interrupted run', err);
	}
}

/** Discard an interrupted run and its phase cache. */
export async function discardInterruptedRun(): Promise<void> {
	const actLineId = displayedActLineId;
	if (!actLineId) return;
	interruptedRun = null;
	await runManager.discardRun(actLineId);
}

export async function runEpilogueFlow(actLineId: string, rewriteDirectorNote?: string): Promise<void> {
	displayedActLineId = actLineId;
	displayedRunStatus = 'running';
	displayedRunKind = 'epilogue';
	error = null;
	try {
		const { assistantMessage } = await runManager.startEpilogueRun({ actLineId, rewriteDirectorNote });
		setMessages([...messages, assistantMessage]);
		syncDisplayedRun();
	} catch (err) {
		error = getErrorMessage(err);
		syncDisplayedRun();
		await log.error('epilogue', 'Failed to start epilogue run', err);
	}
}

export function resetActEnded(): void {
	actEnded = false;
	storyConcluded = false;
}

export async function loadActLineMessages(actLineId: string): Promise<void> {
	displayedActLineId = actLineId;
	syncDisplayedRun();
	interruptedRun = null;
	error = null;
	isAsyncPending = runManager.isProcessingAsyncPhases(actLineId);

	const loaded = await loadActLineMessagesFromDB(actLineId);
	setMessages(loaded);

	actEnded = await dbActLines.isActLineEnded(actLineId);
	storyConcluded = await dbActLines.isEpilogueWritten(actLineId);

	// Re-attach to a live run continuing in the background (e.g. after a story switch).
	const active = runManager.getActiveSession(actLineId);
	if (active) {
		mirrorSessionMessage(active.message);
		return;
	}

	// Surface an interrupted run left behind by an app restart or a stop.
	const pending = await runManager.getInterruptedRunInfo(actLineId);
	if (pending) {
		interruptedRun = pending;
		return;
	}

	const actLine = await dbActLines.getActLine(actLineId);
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

export async function clearMessages(): Promise<void> {
	displayedActLineId = null;
	syncDisplayedRun();
	setMessages([]);
	error = null;
	interruptedRun = null;
	actEnded = false;
	storyConcluded = false;
	isAsyncPending = false;
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
		await runManager.cleanupActLine(actLineId);
		const removed = await removeMessagesById(actLineId, [messageId]);
		if (!removed) {
			await loadActLineMessages(actLineId);
			return;
		}
		// sendInitialNarration will reset `messages` array
		await sendInitialNarration(actLineId, rewriteDirectorNote);
		return;
	}

	// If this is an epilogue, remove and re-run the epilogue flow
	if (await dbActLines.isEpilogueWritten(actLineId)) {
		await runManager.cleanupActLine(actLineId);
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

	await runManager.cleanupActLine(actLineId);
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
	let lastUserMsgIdx = messages.length - 1;
	while (lastUserMsgIdx >= 0 && messages[lastUserMsgIdx].role !== 'user') {
		lastUserMsgIdx--;
	}

	if (lastUserMsgIdx === -1) return;
	while (lastUserMsgIdx > 0 && messages[lastUserMsgIdx - 1].role === 'user') {
		lastUserMsgIdx--;
	}

	await runManager.cleanupActLine(actLineId);
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

	await runManager.cleanupActLine(actLineId);
	const { success, remaining } = await removeMessagesFromIndex(actLineId, messages, lastUserMsgIdx);
	if (success) setMessages(remaining);
}

// --- Metadata backfill for messages whose async phases never completed ---

async function regenerateMissingMetadata(actLine: ActLineMeta, msgs: UIMessage[]): Promise<void> {
	const lastAssistantIdx = msgs.findLastIndex((m) => m.role === 'assistant');
	if (lastAssistantIdx === -1) return;

	const lastAssistant = msgs[lastAssistantIdx];
	if (!lastAssistant.content.trim()) return;
	if (await dbActLines.hasEventForMessage(lastAssistant.id, 'epilogue-written')) return;

	const needsSummary = !lastAssistant.actSummary;
	const needsGameData = !lastAssistant.variables?.gameData;

	if (!needsSummary && !needsGameData) return;

	const abortController = new AbortController();
	isBackfilling = true;
	try {
		const story = await dbActLines.getStoryForActLine(actLine.id);
		if (!story) return;

		if (needsSummary) {
			await regenerateActSummary(story, msgs, lastAssistantIdx, abortController);
		}

		if (needsGameData) {
			await regenerateGameData(story, actLine, msgs, lastAssistantIdx, abortController);
		}
	} catch (err) {
		await log.error('regenerate-metadata', 'Failed to regenerate missing metadata', err);
	} finally {
		isBackfilling = false;
	}
}

async function regenerateActSummary(
	story: Story,
	msgs: UIMessage[],
	assistantIdx: number,
	abortController: AbortController
): Promise<void> {
	const assistantMsg = msgs[assistantIdx];
	const providerConfig = getSummarizerProviderConfig();
	if (!providerConfig?.model) {
		await log.warn('regenerate-metadata', 'No summarizer provider configured, skipping act summary regeneration');
		return;
	}

	const completedScenes = assistantMsg.sceneNumber ?? findLastNonNullSceneNumber(msgs) ?? 1;
	const transcript = buildTranscriptFromMessages(msgs);

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
		msgs[assistantIdx] = { ...assistantMsg, actSummary: result.serializedSummary };
		messages = [...msgs];
		await updatePersistentMessageMetadata(assistantMsg.id, { actSummary: result.serializedSummary });
	}
}

function buildTranscriptFromMessages(msgs: UIMessage[]): { role: 'user' | 'assistant'; content: string }[] {
	const transcript: { role: 'user' | 'assistant'; content: string }[] = [];
	for (const msg of msgs) {
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
	msgs: UIMessage[],
	assistantIdx: number,
	abortController: AbortController
): Promise<void> {
	const assistantMsg = msgs[assistantIdx];
	const providerConfigs = buildPipelineProviderConfigs();
	if (!providerConfigs.gameMaster?.model) {
		await log.warn('regenerate-metadata', 'No GM provider configured, skipping game data regeneration');
		return;
	}

	const plotMode = actLine.plotMode ?? getDefaultPlotMode();
	const currentActPhase = await dbActLines.getActPhase(actLine.id);
	const actPhaseBoundaries = await dbActLines.getActPhaseBoundaries(actLine.id);
	const currentSceneNumber = assistantMsg.sceneNumber ?? 1;
	const completedScenes = currentSceneNumber - 1;
	// Everything before the message being regenerated: scenes 1..N-1 plus the player turn
	// that triggered it, matching what a live GM run folds into its shared prefix.
	const priorMessages = msgs.slice(0, assistantIdx);
	const previousScenePlot = _getScenePlotForScene(priorMessages, completedScenes, plotMode);

	// Rebuild the shared-prefix context so the GM sees the same Tiers 0–2 a live run would.
	// Character profiles and prior-act summaries are not fetched for a one-off regeneration.
	const worldContent = await ensureWorldFile(story.id, story.name, abortController.signal);
	const actPlot = await ensureActPlot({ story, actLine, worldContent, abortSignal: abortController.signal });
	const context: PipelineContext = {
		worldContent,
		actPlot,
		previousActSummaries: [],
		actNumber: 1,
		summarizationPoint: 0,
		characterProfiles: [],
		actSummaryAtSP: '',
		scenesSections: buildScenesSections(priorMessages, 1, previousScenePlot),
	};

	const loadedPrompts = await loadPrompts(story.id, story.name);

	const ctx: PipelineRunContext = buildImportRunContext(
		{ retryCount: 3, backoffIntervalSeconds: 5 },
		abortController.signal,
		createOptionalCallbacks({
			onError: (_phase: PhaseName, err: unknown) => {
				log.error('regenerate-metadata', 'GM phase error', err);
			},
		}),
		{
			generalInstructions: loadedPrompts.generalInstructions,
			mainChatSystemPrompt: loadedPrompts.mainChatSystemPrompt,
			guidanceGameMasterExtractionPrompt: loadedPrompts.guidanceGameMasterExtractionPrompt,
			phaseEventGameMasterExtractionPrompt: loadedPrompts.phaseEventGameMasterExtractionPrompt,
		},
		{
			currentScene: String(currentSceneNumber),
			story: {
				storyId: story.id,
				storyName: story.name,
				actLine: {
					...actLine,
					plotMode,
					currentActPhase,
					actPhaseBoundaries,
					lastPlotGeneration: null,
					actNumber: 1,
					currentActPhaseLengthEstimate: null,
					currentScene: currentSceneNumber,
				},
			},
			context,
		}
	);

	const trackPhase: TrackPhase = (_phaseName, result) => result.state;
	let state: PipelineState = { editorOutput: assistantMsg.content };
	const gmResult = await executeGmPhase(ctx, state);
	state = await trackPhase('GAME_MASTER', gmResult, providerConfigs.gameMaster?.model);
	state = await runGmTemplateFitter(ctx, state, trackPhase);

	if (state.gameData) {
		const existingVars = assistantMsg.variables ?? emptyVariables();
		const updatedVars: NarrativeVariables = { ...existingVars, gameData: state.gameData };
		msgs[assistantIdx] = { ...assistantMsg, variables: updatedVars };
		messages = [...msgs];
		await updateMessageFields(assistantMsg.id, { variables: JSON.stringify(updatedVars) });
	}
}
