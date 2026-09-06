import * as dbActLines from '$lib/db/act-lines';
import * as dbMessages from '$lib/db/messages';
import * as dbPipelineRuns from '$lib/db/pipeline-runs';
import * as dbDirectorNotes from '$lib/db/director-notes';
import { getDatabase } from '$lib/db/database';
import { traceActLineChain } from '$lib/db/acts';
import { getLatestProfilesByActLine } from '$lib/db/character-profiles';
import {
	getDefaultPlotMode,
	getMainProviderConfig,
	isDirectorModeEnabled,
	isInventoryAvailable,
	isReviewerEnabled,
	settings,
	type ProviderConfig,
} from '$lib/stores/settings.svelte';
import { runPipeline, runEpiloguePipeline, type EpiloguePipelineInput } from '$lib/ai/pipeline';
import type {
	ActLineContext,
	AsyncPhaseResults,
	CommonPipelineInput,
	PipelineInput,
	PipelineResult,
	PipelineState,
} from '$lib/ai/pipeline/types';
import type { PipelineRunKind, PipelineRunRecord, RunInputSnapshot } from '$lib/db/pipeline-runs';
import { deleteInventoryByMessages } from '$lib/db/inventory';
import type { PhaseMetadata } from '$lib/ai/chat-stream';
import type { EndingType, UIScenePhase } from '$lib/ai/narrative-types';
import type { Story } from '$lib/db/stories';
import type { ActLineMeta } from '$lib/db/act-lines';
import type { UIMessage } from './types';
import { ensureWorldFile } from '$lib/ai/world-generator';
import { ensureActPlot } from '$lib/ai/act-plot';
import { parseActPlotTargetWordCount } from '$lib/ai/act-plot/target-word-count-parser';
import { parseActPhaseLengthEstimate } from '$lib/ai/plot-planner-output-parser';
import { formatCharacterProfilesSection } from '$lib/definitions/pipeline-sections';
import { otherDirectorNotesHeader, sectionFormat } from '$lib/definitions/common-headers';
import { loadLocaleStrings } from '$lib/localization';
import { setActiveLocale } from '$lib/fs/prompt-loader';
import { log } from '$lib/logging/logger';
import { logMainChat } from '$lib/logging/chat-logger';
import { isAbortLikeError } from '$lib/utils/async';
import { getErrorMessage } from '$lib/utils/error-handling';
import {
	getLatestActSummary as _getLatestActSummary,
	getPlayerContext,
	getPreviousNarrativeMessage,
	getScenePlotForScene as _getScenePlotForScene,
} from './message-queries';
import { resolveAsyncPhaseMetadata, updateMetaData } from './metadata';
import { buildFinalVariables, createPipelineCallbacks } from './pipeline-callbacks';
import {
	loadActLineMessagesFromDB,
	persistMessage,
	persistUserMessage,
	updateLastPlotGeneration,
	updatePersistentMessageMetadata,
} from './persistence';

const LOG_TAG = 'run-manager';

export type RunStatus = 'running' | 'interrupted' | 'failed' | 'completed' | 'discarded';

/** Public view of a run session, delivered via events and getters. */
export interface RunSessionView {
	messageId: string;
	actLineId: string;
	storyId: string;
	kind: PipelineRunKind;
	status: RunStatus;
	message: UIMessage;
	error?: string;
}

export type RunEvent =
	| { type: 'update'; session: RunSessionView }
	| { type: 'settled'; session: RunSessionView; actEnded: boolean; storyConcluded: boolean }
	| { type: 'async-settled'; actLineId: string };

interface InternalSession {
	messageId: string;
	actLineId: string;
	storyId: string;
	kind: PipelineRunKind;
	status: RunStatus;
	message: UIMessage;
	error?: string;
	abortController: AbortController;
	record: PipelineRunRecord;
	mainConfig: ProviderConfig;
	runPromise: Promise<void>;
	discardOnAbort?: boolean;
}

interface RunPlan {
	story: Story;
	actLine: ActLineMeta;
	completedScenes: number;
	sceneNumber: number;
	assistantSequence: number;
	userMessage?: UIMessage;
	resumeRecord?: PipelineRunRecord;
}

// --- Registry + events ---

const sessions = new Map<string, InternalSession>();
const pendingAsyncByLine = new Map<string, Promise<void>>();
const listeners = new Set<(event: RunEvent) => void>();

export function subscribeRuns(listener: (event: RunEvent) => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function emit(event: RunEvent): void {
	for (const listener of listeners) {
		try {
			listener(event);
		} catch (err) {
			void log.error(LOG_TAG, 'Run event listener failed', err);
		}
	}
}

function toView(session: InternalSession): RunSessionView {
	return {
		messageId: session.messageId,
		actLineId: session.actLineId,
		storyId: session.storyId,
		kind: session.kind,
		status: session.status,
		message: session.message,
		error: session.error,
	};
}

function emitUpdate(session: InternalSession): void {
	emit({ type: 'update', session: toView(session) });
}

export function getActiveSession(actLineId: string): RunSessionView | undefined {
	const session = sessions.get(actLineId);
	return session ? toView(session) : undefined;
}

export function isProcessingAsyncPhases(actLineId: string): boolean {
	return pendingAsyncByLine.has(actLineId);
}

async function awaitPendingAsyncPhases(actLineId: string): Promise<void> {
	const pending = pendingAsyncByLine.get(actLineId);
	if (!pending) return;
	try {
		await pending;
	} catch (err) {
		await log.error(LOG_TAG, 'Pending async phases failed', err);
	}
}

// --- Draft reconstruction from the phase cache ---

/** Rebuild the assistant draft message from cached phase outputs (interrupted runs). */
export function draftMessageFromRecord(record: PipelineRunRecord): UIMessage {
	const state = record.state;
	const phases: UIScenePhase[] = [];
	if (state.writerOutput !== undefined) phases.push({ phaseName: 'WRITER', content: state.writerOutput });
	if (state.reviewerOutput !== undefined) phases.push({ phaseName: 'REVIEWER', content: state.reviewerOutput });
	if (state.gameMasterOutput !== undefined) phases.push({ phaseName: 'GAME_MASTER', content: state.gameMasterOutput });
	if (state.scenePlot) phases.push({ phaseName: 'PLOT_PLANNER', content: state.scenePlot });

	const content = state.editorOutput ?? state.writerOutput ?? '';
	const editorVariables = state.editorVariables ?? state.writerVariables ?? null;
	const variables = buildFinalVariables(editorVariables, state.gameData);

	return {
		id: record.messageId,
		role: 'assistant',
		content,
		reasoning: state.editorReasoning ?? '',
		sceneNumber: record.inputSnapshot.completedScenes + 1,
		phases,
		...(variables && { variables }),
	};
}

export interface InterruptedRunInfo {
	record: PipelineRunRecord;
	message: UIMessage;
}

/**
 * Live message for a resumed run — follows the same display rules as a fresh run:
 * the narrative body shows editor output only, and cached phases appear as accordions.
 * The WRITER accordion is shown only when the reviewer is enabled (mirroring
 * `phasesOfMainChat`); with the reviewer disabled the writer output IS the final
 * prose (deterministic editor-from-writer seed), so it goes to the body instead.
 */
export function resumedSessionMessage(record: PipelineRunRecord): UIMessage {
	const state = record.state;
	const reviewerEnabled = isReviewerEnabled();
	const phases: UIScenePhase[] = [];
	if (state.writerOutput !== undefined && reviewerEnabled) phases.push({ phaseName: 'WRITER', content: state.writerOutput });
	if (state.reviewerOutput !== undefined) phases.push({ phaseName: 'REVIEWER', content: state.reviewerOutput });
	if (state.gameMasterOutput !== undefined) phases.push({ phaseName: 'GAME_MASTER', content: state.gameMasterOutput });
	if (state.scenePlot) phases.push({ phaseName: 'PLOT_PLANNER', content: state.scenePlot });

	const editorVariables = state.editorVariables ?? (reviewerEnabled ? null : (state.writerVariables ?? null));
	const editorOutput = state.editorOutput ?? (reviewerEnabled ? '' : (state.writerOutput ?? ''));
	const variables = buildFinalVariables(editorVariables, state.gameData);

	return {
		id: record.messageId,
		role: 'assistant',
		content: editorOutput,
		reasoning: state.editorReasoning ?? '',
		sceneNumber: record.inputSnapshot.completedScenes + 1,
		phases,
		...(variables && { variables }),
	};
}

/** Interrupted run for an act line, if a cache row exists and no live session covers it. */
export async function getInterruptedRunInfo(actLineId: string): Promise<InterruptedRunInfo | null> {
	if (sessions.has(actLineId)) return null;
	const record = await dbPipelineRuns.getPipelineRunForActLine(actLineId);
	if (!record) return null;
	return { record, message: draftMessageFromRecord(record) };
}

// --- Lifecycle API ---

export interface StartMainRunParams {
	actLineId: string;
	/** Player message; undefined for the initial narration of a line. */
	message?: string;
	rewriteDirectorNote?: string;
}

export async function startMainRun(params: StartMainRunParams): Promise<{ userMessage?: UIMessage; assistantMessage: UIMessage }> {
	const { session, plan } = await prepareRun({ ...params, kind: 'main' });
	session.runPromise = executeRun(session, plan);
	return { userMessage: plan.userMessage, assistantMessage: session.message };
}

export interface StartEpilogueRunParams {
	actLineId: string;
	rewriteDirectorNote?: string;
}

export async function startEpilogueRun(params: StartEpilogueRunParams): Promise<{ assistantMessage: UIMessage }> {
	const { session, plan } = await prepareRun({ ...params, kind: 'epilogue' });
	session.runPromise = executeRun(session, plan);
	return { assistantMessage: session.message };
}

/**
 * Resume the interrupted run cached for an act line.
 * Returns the draft message (now streaming) or null when nothing is resumable
 * (stale rows are discarded on validation).
 */
export async function resumeInterruptedRun(actLineId: string): Promise<UIMessage | null> {
	const record = await getResumableRecord(actLineId);
	if (!record) return null;
	const { session, plan } = await prepareRun({ actLineId, kind: record.kind, resumeRecord: record });
	session.runPromise = executeRun(session, plan);
	return session.message;
}

/** Abort (if running) and delete the cached run for an act line. */
export async function discardRun(actLineId: string): Promise<void> {
	const session = sessions.get(actLineId);
	if (session && session.status === 'running') {
		session.discardOnAbort = true;
		session.abortController.abort();
		await session.runPromise;
		return;
	}
	await discardCachedRun(actLineId);
}

/** Stop the running session; completed phases stay cached for continue/discard. */
export function abortRun(actLineId: string): void {
	const session = sessions.get(actLineId);
	if (session?.status === 'running') session.abortController.abort();
}

// --- Cleanup hooks for deletion flows ---

/** Discard any run (live or cached) for an act line whose context is being destroyed. */
export async function cleanupActLine(actLineId: string): Promise<void> {
	const session = sessions.get(actLineId);
	if (session) {
		session.discardOnAbort = true;
		if (session.status === 'running') session.abortController.abort();
	}
	await discardCachedRun(actLineId);
}

export async function cleanupStory(storyId: string): Promise<void> {
	for (const session of sessions.values()) {
		if (session.storyId === storyId) {
			session.discardOnAbort = true;
			if (session.status === 'running') session.abortController.abort();
		}
	}
	const records = await dbPipelineRuns.getPipelineRunsForStory(storyId);
	for (const record of records) {
		await purgeRunSideEffects(record.actLineId, record.messageId);
	}
	await dbPipelineRuns.deletePipelineRunsForStory(storyId);
}

/** Discard runs for every act line belonging to an act. */
export async function cleanupAct(actId: string): Promise<void> {
	const lines = await dbActLines.getActLinesForAct(actId);
	for (const line of lines) {
		const session = sessions.get(line.id);
		if (session) {
			session.discardOnAbort = true;
			if (session.status === 'running') session.abortController.abort();
		}
		await discardCachedRun(line.id);
	}
	await dbPipelineRuns.deletePipelineRunsForAct(actId);
}

/** Delete the cached run row for a line, purging side effects of its (never-persisted) message. */
async function discardCachedRun(actLineId: string): Promise<void> {
	const record = await dbPipelineRuns.getPipelineRunForActLine(actLineId);
	if (record) {
		await purgeRunSideEffects(actLineId, record.messageId);
		await dbPipelineRuns.deletePipelineRun(record.messageId);
	}
}

/**
 * Remove side effects (act line events, inventory rows) recorded under a run's
 * assistant message. Required when a run is discarded before its message is
 * persisted — otherwise those rows would linger for a message that never
 * materializes.
 */
async function purgeRunSideEffects(actLineId: string, messageId: string): Promise<void> {
	try {
		await dbActLines.deleteEventsForMessage(messageId);
	} catch (err) {
		await log.error(LOG_TAG, 'Failed to delete events for discarded run', err);
	}
	if (isInventoryAvailable()) {
		try {
			await deleteInventoryByMessages(actLineId, [messageId]);
		} catch (err) {
			await log.error(LOG_TAG, 'Failed to delete inventory for discarded run', err);
		}
	}
}

// --- Internals ---

function requireMainConfig(): ProviderConfig {
	const config = getMainProviderConfig();
	if (!config) throw new Error('Please configure your AI API provider in Settings.');
	if (!config.model) throw new Error('Please configure a model name in Settings.');
	return config;
}

function newAssistantMessage(id: string, sceneNumber: number): UIMessage {
	return { id, role: 'assistant', content: '', reasoning: '', phases: [], sceneNumber };
}

interface PrepareRunParams {
	actLineId: string;
	kind: PipelineRunKind;
	message?: string;
	rewriteDirectorNote?: string;
	resumeRecord?: PipelineRunRecord;
}

async function prepareRun(params: PrepareRunParams): Promise<{ session: InternalSession; plan: RunPlan }> {
	const { actLineId, kind, resumeRecord } = params;
	const mainConfig = requireMainConfig();

	if (sessions.has(actLineId)) throw new Error('A scene is already generating for this act line.');

	const story = await dbActLines.getStoryForActLine(actLineId);
	const actLine = await dbActLines.getActLine(actLineId);
	if (!actLine) throw new Error('Selected act line no longer exists');

	const existingRow = await dbPipelineRuns.getPipelineRunForActLine(actLineId);
	if (existingRow && existingRow.messageId !== resumeRecord?.messageId) {
		throw new Error('An unfinished scene exists for this act line. Continue or discard it first.');
	}

	await awaitPendingAsyncPhases(actLineId);
	await loadLocaleStrings(story.locale);
	setActiveLocale(story.locale);

	let userMessage: UIMessage | undefined;
	let completedScenes: number;
	let snapshot: RunInputSnapshot;
	let messageId: string;

	if (resumeRecord) {
		completedScenes = resumeRecord.inputSnapshot.completedScenes;
		snapshot = { ...resumeRecord.inputSnapshot };
		messageId = resumeRecord.messageId;
	} else {
		completedScenes = (await dbActLines.getLastSceneNumber(actLineId)) ?? 0;
		if (kind === 'main' && params.message !== undefined) {
			userMessage = await persistUserMessage(params.message, completedScenes, actLineId);
		}
		const directorNotes = await composeDirectorNotes(actLineId, params.rewriteDirectorNote, completedScenes + 1);
		const endingType = kind === 'epilogue' ? await resolveEndingType(actLineId) : undefined;
		snapshot = {
			directorNotes,
			completedScenes,
			...(userMessage && { playerMessageId: userMessage.id }),
			...(endingType && { endingType }),
		};
		messageId = crypto.randomUUID();
	}

	const record: PipelineRunRecord = resumeRecord ?? {
		messageId,
		actLineId,
		storyId: story.id,
		kind,
		state: {},
		phaseMetadata: [],
		inputSnapshot: snapshot,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
	if (!resumeRecord) await dbPipelineRuns.upsertPipelineRun(record);

	const assistantSequence = await dbActLines.getNextSequence(actLineId);
	const sceneNumber = completedScenes + 1;

	const session: InternalSession = {
		messageId,
		actLineId,
		storyId: story.id,
		kind,
		status: 'running',
		message: resumeRecord ? resumedSessionMessage(resumeRecord) : newAssistantMessage(messageId, sceneNumber),
		abortController: new AbortController(),
		record,
		mainConfig,
		runPromise: Promise.resolve(),
	};
	sessions.set(actLineId, session);

	return { session, plan: { story, actLine, completedScenes, sceneNumber, assistantSequence, userMessage, resumeRecord } };
}

async function resolveEndingType(actLineId: string): Promise<EndingType> {
	const endingType = await dbActLines.getEndingType(actLineId);
	if (!endingType) throw new Error('Cannot run epilogue: no ending type set.');
	return endingType;
}

/** Same filtering/formatting as the director notes store, resolved from the DB. */
async function resolveDirectorNotesText(actLineId: string, currentScene: number): Promise<string> {
	const notes = await dbDirectorNotes.getDirectorNotes(actLineId);
	const active = notes.filter((n) => {
		if (!n.isActive) return false;
		if (n.effectiveFromScene !== null && currentScene < n.effectiveFromScene) return false;
		if (n.effectiveToScene !== null && currentScene > n.effectiveToScene) return false;
		return true;
	});
	return active.map((n, i) => `${i + 1}. ${n.text}`).join('\n');
}

async function composeDirectorNotes(actLineId: string, rewriteNote: string | undefined, targetScene: number): Promise<string> {
	const existingNotes = isDirectorModeEnabled() ? await resolveDirectorNotesText(actLineId, targetScene) : '';
	if (!rewriteNote) return existingNotes;
	if (!existingNotes) return rewriteNote;
	return rewriteNote + '\n\n' + sectionFormat(otherDirectorNotesHeader()) + existingNotes;
}

/**
 * Validate the cached row and auto-discard it when its context is gone
 * (act line deleted, or the player message removed).
 */
async function getResumableRecord(actLineId: string): Promise<PipelineRunRecord | null> {
	if (sessions.has(actLineId)) return null;
	const record = await dbPipelineRuns.getPipelineRunForActLine(actLineId);
	if (!record) return null;

	const actLine = await dbActLines.getActLine(actLineId);
	if (!actLine) {
		await dbPipelineRuns.deletePipelineRun(record.messageId);
		return null;
	}

	if (record.kind === 'main' && record.inputSnapshot.playerMessageId) {
		const lineMessages = await loadActLineMessagesFromDB(actLineId);
		if (!lineMessages.some((m) => m.id === record.inputSnapshot.playerMessageId)) {
			// Defensive: message-deletion flows clean up runs first, but if the
			// player message is gone the run context is invalid — discard fully.
			await purgeRunSideEffects(actLineId, record.messageId);
			await dbPipelineRuns.deletePipelineRun(record.messageId);
			return null;
		}
	}

	return record;
}

async function executeRun(session: InternalSession, plan: RunPlan): Promise<void> {
	try {
		const input = await buildPipelineInput(session, plan);
		const result =
			session.kind === 'main' ? await runPipeline(input as PipelineInput) : await runEpiloguePipeline(input as EpiloguePipelineInput);
		// Unregister before settling so listeners observe the final state (and
		// the interrupted-run lookup is not shadowed by the live session).
		sessions.delete(session.actLineId);
		await finalizeRun(session, plan, result);
	} catch (err) {
		sessions.delete(session.actLineId);
		await settleRunWithError(session, err);
	}
}

async function buildPipelineInput(session: InternalSession, plan: RunPlan): Promise<PipelineInput | EpiloguePipelineInput> {
	const { abortController, kind, record } = session;
	const abortSignal = abortController.signal;
	const { story, actLine, completedScenes, sceneNumber, assistantSequence, resumeRecord } = plan;
	const isMain = kind === 'main';

	const worldContent = await ensureWorldFile(story.id, story.name, abortSignal);
	const actPlot = await ensureActPlot({ story, actLine, worldContent, abortSignal });

	const snapshot = record.inputSnapshot;
	if (snapshot.targetWordCount === undefined) {
		snapshot.targetWordCount = parseActPlotTargetWordCount(actPlot) ?? settings.targetWordCount;
		// Persist the resolved value so a resumed run sees the same target even
		// if settings change before the first phase completes.
		session.record.updatedAt = Date.now();
		const stillPresent = await dbPipelineRuns.updatePipelineRunIfExists(session.record);
		if (!stillPresent) {
			session.abortController.abort();
		}
	}
	const targetWordCount = snapshot.targetWordCount;

	const lineMessages = await loadActLineMessagesFromDB(actLine.id);
	const actSummary = _getLatestActSummary(lineMessages, completedScenes);
	const plotMode = actLine.plotMode ?? getDefaultPlotMode();
	const previousScenePlot = isMain ? _getScenePlotForScene(lineMessages, completedScenes, plotMode) : undefined;
	const previousNarrativeVariables = getPreviousNarrativeMessage(lineMessages);
	const player = isMain ? getPlayerContext(lineMessages) : undefined;

	const previousActSummaries: { actNumber: number; summary: string }[] = [];
	const actNumber = (await dbActLines.getActNumberForActLine(actLine.id)) ?? 1;
	if (isMain && actNumber > 1) {
		const chain = await traceActLineChain(actLine.id);
		for (const entry of chain.slice(0, -1)) {
			const shortSummary = await dbActLines.getActShortSummary(entry.actLineId);
			if (shortSummary) previousActSummaries.push({ actNumber: entry.actNumber, summary: shortSummary });
		}
	}

	const characterProfiles = formatCharacterProfilesSection(
		await getLatestProfilesByActLine(actLine.id),
		settings.characterProfileImportanceThreshold,
		settings.characterProfileMaxIncluded
	);

	const actLineContext = isMain
		? await buildMainActLineContext(actLine, plotMode, previousScenePlot, sceneNumber)
		: await buildEpilogueActLineContext(actLine, sceneNumber);

	const callbacks = createPipelineCallbacks({
		getCurrentMessage: () => session.message,
		setCurrentMessage: (message) => {
			session.message = message;
			emitUpdate(session);
		},
		onError: (errorMessage) => {
			session.error = errorMessage;
		},
	});

	const common: CommonPipelineInput = {
		execution: {
			abortSignal,
			callbacks,
			onPhaseCommit: (state, phases) => commitPhaseCache(session, state, phases),
		},
		worldContent,
		actPlot,
		actSummary,
		characterProfiles,
		directorNotes: snapshot.directorNotes,
		previousNarrativeVariables,
		previousActSummaries,
		story: { storyId: story.id, storyName: story.name, actLine: actLineContext },
		assistant: { messageId: session.messageId, messageSequence: assistantSequence },
		completedScenes,
		targetWordCount,
		initialState: resumeRecord?.state,
		initialPhases: resumeRecord?.phaseMetadata,
	};

	if (isMain) return { ...common, previousScenePlot, player };
	return { ...common, endingType: snapshot.endingType ?? (await resolveEndingType(actLine.id)) };
}

async function buildMainActLineContext(
	actLine: ActLineMeta,
	plotMode: 'guidance' | 'phaseEvent',
	previousScenePlot: string | undefined,
	currentScene: number
): Promise<ActLineContext> {
	const [currentActPhase, actPhaseBoundaries, lastPlotGeneration, actNumber] = await Promise.all([
		dbActLines.getActPhase(actLine.id),
		dbActLines.getActPhaseBoundaries(actLine.id),
		dbActLines.getLastPlotGeneration(actLine.id),
		dbActLines.getActNumberForActLine(actLine.id),
	]);
	return {
		...actLine,
		currentActPhase,
		actPhaseBoundaries,
		lastPlotGeneration,
		actNumber: actNumber ?? 1,
		currentActPhaseLengthEstimate: plotMode === 'phaseEvent' ? parseActPhaseLengthEstimate(previousScenePlot) : null,
		currentScene,
	};
}

async function buildEpilogueActLineContext(actLine: ActLineMeta, currentScene: number): Promise<ActLineContext> {
	const actNumber = (await dbActLines.getActNumberForActLine(actLine.id)) ?? 1;
	return {
		...actLine,
		currentActPhase: null,
		actPhaseBoundaries: [],
		lastPlotGeneration: null,
		actNumber,
		currentActPhaseLengthEstimate: null,
		currentScene,
	};
}

/** Persist the phase cache after every completed phase (web mode: flush to OPFS). */
async function commitPhaseCache(session: InternalSession, state: PipelineState, phases: PhaseMetadata[]): Promise<void> {
	session.record.state = state;
	session.record.phaseMetadata = phases;
	session.record.updatedAt = Date.now();
	const stillPresent = await dbPipelineRuns.updatePipelineRunIfExists(session.record);
	if (!stillPresent) {
		// The cache row was removed externally (story/act/line deleted): stop the run.
		await log.warn(LOG_TAG, `Phase cache for act line ${session.actLineId} was removed; aborting run`);
		session.abortController.abort();
		return;
	}
	await getDatabase().flush();
}

async function finalizeRun(session: InternalSession, plan: RunPlan, result: PipelineResult): Promise<void> {
	// Guard against deletion racing with the final commit (story/act/line removed mid-run).
	const actLineStillExists = await dbActLines.getActLine(session.actLineId);
	if (!actLineStillExists) {
		session.status = 'discarded';
		emit({ type: 'settled', session: toView(session), actEnded: false, storyConcluded: false });
		return;
	}

	const assistant = { messageId: session.messageId, messageSequence: plan.assistantSequence };

	session.message = { ...session.message, metadata: updateMetaData(result.aggregatedMetadata, result.phases) };
	emitUpdate(session);

	// Idempotency guard: if the app was quit after the message was persisted
	// but before the cache row was deleted, resume reaches this point with all
	// phases cached — skip re-creating the message instead of failing on the
	// duplicate primary key.
	const alreadyPersisted = (await dbMessages.getMessagesByIds([session.messageId])).length > 0;
	if (!alreadyPersisted) {
		await persistMessage(session.actLineId, session.message, plan.assistantSequence);
		const newMessages = plan.userMessage ? [plan.userMessage, session.message] : [session.message];
		await logMainChat({ newMessages });
	}
	await updateLastPlotGeneration(result.phases, session.actLineId, assistant, plan.completedScenes);
	await dbPipelineRuns.deletePipelineRun(session.messageId);

	let storyConcluded = false;
	if (session.kind === 'epilogue') {
		await dbActLines.recordEpilogueWritten(session.actLineId, assistant);
		storyConcluded = true;
	}
	const actEnded = await dbActLines.isActLineEnded(session.actLineId);

	if (result.asyncPhases) wireAsyncPhases(session, result.asyncPhases);

	session.status = 'completed';
	emit({ type: 'settled', session: toView(session), actEnded, storyConcluded });
}

async function settleRunWithError(session: InternalSession, err: unknown): Promise<void> {
	if (isAbortLikeError(err)) {
		if (session.discardOnAbort) {
			try {
				await purgeRunSideEffects(session.actLineId, session.messageId);
				await dbPipelineRuns.deletePipelineRun(session.messageId);
			} catch (cleanupErr) {
				await log.error(LOG_TAG, 'Failed to delete discarded run', cleanupErr);
			}
			session.status = 'discarded';
			await log.warn(LOG_TAG, `Run discarded for act line ${session.actLineId}`);
		} else {
			session.status = 'interrupted';
			await log.warn(LOG_TAG, `Run interrupted for act line ${session.actLineId}; phase cache kept for resume`);
		}
	} else {
		// Keep the cache (and any tool side effects) so the user can fix the
		// cause and Continue; discard cleans them up if the run is rejected.
		session.status = 'failed';
		session.error = session.error ?? getErrorMessage(err);
		await log.error(LOG_TAG, `Run failed for act line ${session.actLineId}`, err);
	}
	emit({ type: 'settled', session: toView(session), actEnded: false, storyConcluded: false });
}

/** Track async phases (Summarizer → Compressor → Memory) per line after the main chain completes. */
function wireAsyncPhases(session: InternalSession, asyncPhases: Promise<AsyncPhaseResults>): void {
	const pending = (async () => {
		try {
			const asyncResults = await asyncPhases;
			const { updatedMessage, metadataUpdates } = resolveAsyncPhaseMetadata(session.message, asyncResults, session.mainConfig);
			session.message = updatedMessage;
			emitUpdate(session);
			await updatePersistentMessageMetadata(session.messageId, metadataUpdates);
		} catch (err) {
			if (isAbortLikeError(err)) {
				await log.warn(LOG_TAG, 'Async phases aborted');
			} else {
				await log.error(LOG_TAG, 'Async phases failed', err);
			}
		} finally {
			pendingAsyncByLine.delete(session.actLineId);
			emit({ type: 'async-settled', actLineId: session.actLineId });
		}
	})();
	pendingAsyncByLine.set(session.actLineId, pending);
}
