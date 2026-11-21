import { describe, it, expect, vi, beforeEach } from 'vitest';

const settingsMock = vi.hoisted(() => ({ reviewerEnabled: false }));

vi.mock('#lib/stores/settings.svelte.ts', () => ({
	settings: {
		targetWordCount: 400,
		importantPhraseHighlighting: false,
		summarizationPointInterval: 10,
		characterProfileImportanceThreshold: 3,
		characterProfileMaxIncluded: 20,
	},
	getDefaultPlotMode: () => 'guidance',
	getMainProviderConfig: () => ({ id: 'main', model: 'test-model', apiKey: 'k' }),
	getSummarizerProviderConfig: () => ({ id: 'sum', model: 'sum-model', apiKey: 'k' }),
	isDirectorModeEnabled: () => false,
	isInventoryAvailable: () => false,
	isReviewerEnabled: () => settingsMock.reviewerEnabled,
}));

vi.mock('#lib/logging/logger.ts', () => ({
	log: { info: vi.fn(async () => {}), error: vi.fn(async () => {}), warn: vi.fn(async () => {}), debug: vi.fn(async () => {}) },
	fileLog: vi.fn(async () => {}),
}));

vi.mock('#lib/logging/chat-logger.ts', () => ({ logMainChat: vi.fn(async () => {}) }));
vi.mock('#lib/ai/pipeline/index.ts', () => ({ runPipeline: vi.fn(), runEpiloguePipeline: vi.fn() }));
vi.mock('#lib/ai/world-generator/index.ts', () => ({ ensureWorldFile: vi.fn(async () => 'world') }));
vi.mock('#lib/ai/act-plot/index.ts', () => ({ ensureActPlot: vi.fn(async () => 'plot') }));
vi.mock('#lib/localization/index.ts', () => ({ loadLocaleStrings: vi.fn(async () => {}), ls: (k: string) => k }));
vi.mock('#lib/fs/prompt-loader.ts', () => ({ setActiveLocale: vi.fn() }));
vi.mock('#lib/db/database.ts', () => ({ initDatabase: vi.fn(), getDatabase: () => ({ flush: vi.fn(async () => {}) }) }));
vi.mock('#lib/db/act-lines.ts', () => ({
	getStoryForActLine: vi.fn(async () => ({ id: 'story-1', name: 'Story', locale: 'en', createdAt: 0, updatedAt: 0 })),
	getActLine: vi.fn(async () => ({ id: 'line-1', actId: 'act-1', name: 'Main', isMainLine: true, createdAt: 0, plotMode: 'guidance' })),
	getLastSceneNumber: vi.fn(async () => 0),
	getNextSequence: vi.fn(async () => 1),
	getActNumberForActLine: vi.fn(async () => 1),
	getActPhase: vi.fn(async () => null),
	getActPhaseBoundaries: vi.fn(async () => []),
	getLastPlotGeneration: vi.fn(async () => null),
	isActLineEnded: vi.fn(async () => false),
	deleteEventsForMessage: vi.fn(async () => {}),
	recordPlotGeneration: vi.fn(async () => {}),
	recordEpilogueWritten: vi.fn(async () => {}),
	getEndingType: vi.fn(async () => null),
}));
vi.mock('#lib/db/pipeline-runs.ts', () => ({
	getPipelineRunForActLine: vi.fn(async () => null),
	upsertPipelineRun: vi.fn(async () => {}),
	updatePipelineRunIfExists: vi.fn(async () => true),
	deletePipelineRun: vi.fn(async () => {}),
	getPipelineRun: vi.fn(async () => null),
	getPipelineRunsForStory: vi.fn(async () => []),
	deletePipelineRunsForActLine: vi.fn(async () => {}),
	deletePipelineRunsForAct: vi.fn(async () => {}),
	deletePipelineRunsForStory: vi.fn(async () => {}),
}));
vi.mock('#lib/db/director-notes.ts', () => ({ getDirectorNotes: vi.fn(async () => []) }));
vi.mock('#lib/db/messages.ts', () => ({ getMessagesByIds: vi.fn(async () => []) }));
vi.mock('#lib/db/acts.ts', () => ({ traceActLineChain: vi.fn(async () => []) }));
vi.mock('#lib/db/character-profiles.ts', () => ({ getLatestProfilesByActLine: vi.fn(async () => []) }));
vi.mock('#lib/db/inventory.ts', () => ({ deleteInventoryByMessages: vi.fn(async () => {}) }));
vi.mock('#lib/db/message-phases.ts', () => ({
	upsertMessagePhases: vi.fn(async () => {}),
	getPhasesForMessages: vi.fn(async () => new Map()),
	deletePhasesForMessages: vi.fn(async () => {}),
}));
vi.mock('#lib/ai/chat/persistence.ts', () => ({
	loadActLineMessagesFromDB: vi.fn(async () => []),
	persistMessage: vi.fn(async () => {}),
	persistUserMessage: vi.fn(async () => ({ id: 'user-1', role: 'user', content: 'hi', sceneNumber: 0 })),
	updateLastPlotGeneration: vi.fn(async () => {}),
	updatePersistentMessageMetadata: vi.fn(async () => {}),
	serializeImportantPhrases: (phrases: string[]) => phrases.join('\n'),
}));

import {
	abortRun,
	draftMessageFromRecord,
	getActiveSession,
	resumedSessionMessage,
	startMainRun,
	subscribeRuns,
	trackStreamingPhase,
	type RunEvent,
} from '#lib/ai/chat/run-manager.ts';
import { runPipeline } from '#lib/ai/pipeline/index.ts';
import { persistMessage, updatePersistentMessageMetadata } from '#lib/ai/chat/persistence.ts';
import { fileLog } from '#lib/logging/logger.ts';
import * as dbMessagePhases from '#lib/db/message-phases.ts';
import type { PipelineRunRecord } from '#lib/db/pipeline-runs.ts';
import type { PipelineCallbacks } from '#lib/ai/pipeline/types.ts';
import type { GameDataFields, NarrativeVariables, PhaseName } from '#lib/ai/narrative-types.ts';

const vars = (over: Partial<NarrativeVariables>): NarrativeVariables => ({
	sceneTitle: null,
	background: null,
	narrativeBody: null,
	turnOfEvents: null,
	cg: null,
	gameData: null,
	...over,
});

const gameData = (over: Partial<GameDataFields>): GameDataFields => ({
	activePlotThreads: [],
	decisionContext: null,
	decisions: [],
	...over,
});

function makeRecord(state: PipelineRunRecord['state'], completedScenes = 2): PipelineRunRecord {
	return {
		messageId: 'msg-1',
		actLineId: 'line-1',
		storyId: 'story-1',
		kind: 'main',
		state,
		phaseMetadata: [],
		inputSnapshot: { directorNotes: '', completedScenes },
		createdAt: 0,
		updatedAt: 0,
	};
}

describe('draftMessageFromRecord', () => {
	it('derives the scene number from completedScenes', () => {
		const draft = draftMessageFromRecord(makeRecord({ writerOutput: 'draft' }, 4));
		expect(draft.sceneNumber).toBe(5);
		expect(draft.id).toBe('msg-1');
		expect(draft.role).toBe('assistant');
	});

	it('uses writer output as content and lists the writer phase when only the writer completed', () => {
		const draft = draftMessageFromRecord(makeRecord({ writerOutput: 'a rough draft' }));
		expect(draft.content).toBe('a rough draft');
		expect(draft.phases).toEqual([{ phaseName: 'WRITER', content: 'a rough draft' }]);
		expect(draft.variables).toBeUndefined();
	});

	it('prefers editor output for content and merges editor variables with game data', () => {
		const record = makeRecord({
			writerOutput: 'rough',
			reviewerOutput: 'review notes',
			editorOutput: 'polished',
			editorVariables: vars({ sceneTitle: 'Title', narrativeBody: 'Body' }),
			gameData: gameData({ decisions: ['Go left'] }),
		});
		const draft = draftMessageFromRecord(record);

		expect(draft.content).toBe('polished');
		expect(draft.phases?.map((p) => p.phaseName)).toEqual(['WRITER', 'REVIEWER', 'EDITOR']);
		expect(draft.variables?.sceneTitle).toBe('Title');
		expect(draft.variables?.gameData?.decisions).toEqual(['Go left']);
	});

	it('falls back to writer variables when no editor variables exist', () => {
		const record = makeRecord({
			writerOutput: 'rough',
			writerVariables: vars({ narrativeBody: 'Body' }),
		});
		const draft = draftMessageFromRecord(record);
		expect(draft.variables?.narrativeBody).toBe('Body');
	});

	it('includes editor reasoning and a plot planner phase', () => {
		const record = makeRecord({
			writerOutput: 'rough',
			editorOutput: 'polished',
			editorReasoning: 'thought process',
			gameMasterOutput: 'gm output',
			scenePlot: 'next scene plan',
		});
		const draft = draftMessageFromRecord(record);
		expect(draft.reasoning).toBe('thought process');
		expect(draft.phases?.map((p) => p.phaseName)).toEqual(['WRITER', 'EDITOR', 'GAME_MASTER', 'PLOT_PLANNER']);
		expect(draft.phases?.[1]).toEqual({ phaseName: 'EDITOR', content: 'polished', reasoning: 'thought process' });
	});

	it('omits an empty carried-forward scene plot from the phase list', () => {
		const record = makeRecord({ writerOutput: 'rough', scenePlot: '' });
		const draft = draftMessageFromRecord(record);
		expect(draft.phases?.map((p) => p.phaseName)).toEqual(['WRITER']);
	});

	it('returns empty content for an empty state (interrupted before the first phase)', () => {
		const draft = draftMessageFromRecord(makeRecord({}));
		expect(draft.content).toBe('');
		expect(draft.phases).toEqual([]);
		expect(draft.variables).toBeUndefined();
	});
});

describe('resumedSessionMessage', () => {
	beforeEach(() => {
		settingsMock.reviewerEnabled = false;
	});

	it('keeps the body empty and shows the writer accordion when only the writer completed with the reviewer enabled', () => {
		settingsMock.reviewerEnabled = true;
		const message = resumedSessionMessage(makeRecord({ writerOutput: 'rough draft', writerVariables: vars({ narrativeBody: 'Body' }) }));
		// A fresh run renders writer output inside the WRITER accordion, never as the narrative body.
		expect(message.content).toBe('');
		expect(message.phases).toEqual([{ phaseName: 'WRITER', content: 'rough draft' }]);
		expect(message.variables).toBeUndefined();
	});

	it('puts writer output in the body without an accordion when the reviewer is disabled (editor-from-writer seed)', () => {
		const message = resumedSessionMessage(
			makeRecord({ writerOutput: 'final prose', writerVariables: vars({ sceneTitle: 'Title', narrativeBody: 'Body' }) })
		);
		expect(message.content).toBe('final prose');
		expect(message.phases).toEqual([]);
		expect(message.variables?.sceneTitle).toBe('Title');
	});

	it('renders cached editor output as the body with merged game data and accordions for completed phases', () => {
		settingsMock.reviewerEnabled = true;
		const message = resumedSessionMessage(
			makeRecord({
				writerOutput: 'rough',
				reviewerOutput: 'notes',
				editorOutput: 'polished',
				editorReasoning: 'thoughts',
				editorVariables: vars({ sceneTitle: 'Title', narrativeBody: 'Body' }),
				gameData: gameData({ decisions: ['Go left'] }),
				gameMasterOutput: 'gm output',
				scenePlot: 'next plan',
			})
		);
		expect(message.content).toBe('polished');
		expect(message.reasoning).toBe('thoughts');
		expect(message.phases?.map((p) => p.phaseName)).toEqual(['WRITER', 'REVIEWER', 'EDITOR', 'GAME_MASTER', 'PLOT_PLANNER']);
		expect(message.phases?.[2]).toEqual({ phaseName: 'EDITOR', content: 'polished', reasoning: 'thoughts' });
		expect(message.variables?.sceneTitle).toBe('Title');
		expect(message.variables?.gameData?.decisions).toEqual(['Go left']);
	});

	it('includes an EDITOR entry even with the reviewer disabled, while WRITER stays hidden', () => {
		// Reviewer-off runs seed the editor from the writer; the EDITOR chip must
		// still appear (design §4.4) while the WRITER stream remains the body seed.
		const message = resumedSessionMessage(makeRecord({ writerOutput: 'final prose', editorOutput: 'final prose' }));
		expect(message.content).toBe('final prose');
		expect(message.phases).toEqual([{ phaseName: 'EDITOR', content: 'final prose' }]);
	});

	it('derives the scene number from completedScenes', () => {
		const message = resumedSessionMessage(makeRecord({ editorOutput: 'x' }, 4));
		expect(message.sceneNumber).toBe(5);
		expect(message.id).toBe('msg-1');
		expect(message.role).toBe('assistant');
	});

	it('returns an empty body for an empty state (interrupted before the first phase)', () => {
		const message = resumedSessionMessage(makeRecord({}));
		expect(message.content).toBe('');
		expect(message.phases).toEqual([]);
		expect(message.variables).toBeUndefined();
	});
});

describe('trackStreamingPhase', () => {
	function makeInner(): PipelineCallbacks {
		return {
			onPhaseStart: vi.fn(),
			onPhaseStream: vi.fn(),
			onPhaseRetry: vi.fn(),
			onPhaseComplete: vi.fn(),
			onPhaseFailed: vi.fn(),
			onError: vi.fn(),
			onAllComplete: vi.fn(),
		};
	}

	it('adds the phase on start and removes it on complete', () => {
		const inner = makeInner();
		const session = { streamingPhases: [] as PhaseName[] };
		const onUpdate = vi.fn();
		const wrapped = trackStreamingPhase(session, inner, onUpdate);

		wrapped.onPhaseStart('WRITER');
		expect(session.streamingPhases).toEqual(['WRITER']);
		expect(inner.onPhaseStart).toHaveBeenCalledWith('WRITER');
		expect(onUpdate).toHaveBeenCalledTimes(1);

		wrapped.onPhaseStream('WRITER', { content: 'x', reasoning: null, variables: null });
		expect(session.streamingPhases).toEqual(['WRITER']);

		wrapped.onPhaseComplete('WRITER', { writerOutput: 'x' });
		expect(session.streamingPhases).toEqual([]);
		expect(inner.onPhaseComplete).toHaveBeenCalledWith('WRITER', { writerOutput: 'x' }, undefined);
		expect(onUpdate).toHaveBeenCalledTimes(2);
	});

	it('keeps a single entry when the same phase starts twice', () => {
		const session = { streamingPhases: [] as PhaseName[] };
		const wrapped = trackStreamingPhase(session, makeInner(), vi.fn());
		wrapped.onPhaseStart('WRITER');
		wrapped.onPhaseStart('WRITER');
		expect(session.streamingPhases).toEqual(['WRITER']);
	});

	it('tracks concurrent phases independently — completing one keeps the other spinning', () => {
		// WHY: GM ‖ Plot Planner (and later Summarizer ‖ Writer) stream at the same
		// time; a single slot made the second phase overwrite the first's spinner.
		const session = { streamingPhases: [] as PhaseName[] };
		const wrapped = trackStreamingPhase(session, makeInner(), vi.fn());

		wrapped.onPhaseStart('GAME_MASTER');
		wrapped.onPhaseStart('PLOT_PLANNER');
		expect(session.streamingPhases).toEqual(['GAME_MASTER', 'PLOT_PLANNER']);

		wrapped.onPhaseComplete('GAME_MASTER', { gameMasterOutput: 'gm' });
		expect(session.streamingPhases).toEqual(['PLOT_PLANNER']);

		wrapped.onPhaseComplete('PLOT_PLANNER', { scenePlot: 'plot' });
		expect(session.streamingPhases).toEqual([]);
	});

	it('passes every other callback through untouched', () => {
		const inner = makeInner();
		const session = { streamingPhases: [] as PhaseName[] };
		const wrapped = trackStreamingPhase(session, inner, vi.fn());

		const streamState = { content: 'c', reasoning: null, variables: null };
		wrapped.onPhaseStream('EDITOR', streamState);
		expect(inner.onPhaseStream).toHaveBeenCalledWith('EDITOR', streamState);
		wrapped.onPhaseRetry('EDITOR', 1, 3);
		expect(inner.onPhaseRetry).toHaveBeenCalledWith('EDITOR', 1, 3);
		wrapped.onAllComplete({});
		expect(inner.onAllComplete).toHaveBeenCalledWith({});
	});

	it('forwards compressor failure details and clears its spinner', () => {
		// WHY: the terminal log/usage must reach the callbacks, and a failed phase
		// must stop spinning even though it keeps its chip.
		const inner = makeInner();
		const session = { streamingPhases: ['CHARACTER_PROFILE_COMPRESSOR'] as PhaseName[] };
		const onUpdate = vi.fn();
		const wrapped = trackStreamingPhase(session, inner, onUpdate);
		const details = {
			profileCompressionLog: '## Failed\n\ncheckpoint down',
			metadata: {
				finishReason: 'stop',
				usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
				durationMs: 1,
				models: new Set(['m']),
			},
		};

		wrapped.onPhaseFailed?.('CHARACTER_PROFILE_COMPRESSOR', details);

		expect(session.streamingPhases).toEqual([]);
		expect(onUpdate).toHaveBeenCalledTimes(1);
		expect(inner.onPhaseFailed).toHaveBeenCalledWith('CHARACTER_PROFILE_COMPRESSOR', details);
	});
});

describe('phase persistence on settle', () => {
	beforeEach(() => {
		settingsMock.reviewerEnabled = false;
		vi.mocked(dbMessagePhases.upsertMessagePhases).mockClear();
		vi.mocked(fileLog).mockClear();
	});

	it('upserts phases at main settle and again after the background chain lands', async () => {
		// The write path is the whole point of message_phases: phases must survive
		// reload (main settle) and gain SUMMARIZER/COMPRESSOR rows when the background
		// chain finishes after it (background settle).
		vi.mocked(runPipeline).mockImplementation(async (input) => {
			const cb = input.execution.callbacks;
			cb.onPhaseStart('EDITOR');
			cb.onPhaseStream('EDITOR', { content: 'final prose', reasoning: 'thoughts', variables: null });
			cb.onPhaseComplete('EDITOR', { editorOutput: 'final prose', editorReasoning: 'thoughts' });
			cb.onPhaseStart('SUMMARIZER');
			cb.onPhaseComplete(
				'SUMMARIZER',
				{ actSummary: 'the summary' },
				{
					finishReason: 'stop',
					usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
					durationMs: 1,
					models: new Set(['sum-model']),
				}
			);
			return {
				state: { editorOutput: 'final prose' },
				phases: [],
				backgroundPhases: Promise.resolve({ actSummary: 'the summary' }),
			};
		});

		const events: RunEvent[] = [];
		let resolveSettled!: () => void;
		let resolveBackgroundSettled!: () => void;
		const settled = new Promise<void>((r) => (resolveSettled = r));
		const backgroundSettled = new Promise<void>((r) => (resolveBackgroundSettled = r));
		const off = subscribeRuns((e) => {
			events.push(e);
			if (e.type === 'settled') resolveSettled();
			if (e.type === 'background-settled') resolveBackgroundSettled();
		});

		const { assistantMessage } = await startMainRun({ actLineId: 'line-1', message: 'go' });
		await settled;
		await backgroundSettled;
		off();

		const upserts = vi.mocked(dbMessagePhases.upsertMessagePhases).mock.calls;
		expect(upserts).toHaveLength(2);
		// Main settle: background rows are excluded (the background chain owns them).
		expect(upserts[0][0]).toBe(assistantMessage.id);
		expect(upserts[0][1]).toEqual([{ phaseName: 'EDITOR', content: 'final prose', reasoning: 'thoughts' }]);
		// Background settle: the full array, SUMMARIZER content from the lifecycle callbacks.
		expect(upserts[1][0]).toBe(assistantMessage.id);
		expect(upserts[1][1].map((p) => p.phaseName)).toEqual(['EDITOR', 'SUMMARIZER']);
		expect(upserts[1][1][1].content).toBe('the summary');

		// The early-merged summarizer metadata survives finalize's rebuild (no double count).
		const persisted = vi.mocked(persistMessage).mock.calls[0][1];
		expect(persisted.metadata?.phases?.map((p) => p.phaseName)).toEqual(['SUMMARIZER']);
		expect(persisted.metadata?.inputTokens).toBe(10);

		// streamingPhases drives the strip spinner: live during the phase, gone on settle.
		expect(events.some((e) => e.type === 'update' && e.session.streamingPhases.includes('EDITOR'))).toBe(true);
		const settledEvent = events.find((e) => e.type === 'settled');
		expect(settledEvent?.type === 'settled' && settledEvent.session.streamingPhases).toEqual([]);

		// WHY: the finalize report only covers main-tracker phases; background usage
		// must get its own report when the chain lands, or cache measurement misses it.
		const cacheLogs = vi.mocked(fileLog).mock.calls.filter((c) => c[1] === 'pipeline-cache');
		expect(cacheLogs.length).toBe(2);
		const backgroundReport = (cacheLogs[1][2] as () => string)();
		expect(backgroundReport).toContain('SUMMARIZER');
		expect(backgroundReport).toContain('input=10');
	});

	it('persists a successful compressor terminal log and usage after background settle', async () => {
		// WHY: the markdown body (content) and applied-attempt log (processedContent)
		// must be the rows the UI reloads, exactly like the failed-log path.
		vi.mocked(runPipeline).mockImplementation(async (input) => {
			const cb = input.execution.callbacks;
			cb.onPhaseStart('EDITOR');
			cb.onPhaseComplete('EDITOR', { editorOutput: 'prose' });
			cb.onPhaseStart('CHARACTER_PROFILE_COMPRESSOR');
			cb.onPhaseStream('CHARACTER_PROFILE_COMPRESSOR', {
				content: '# Profile Updates',
				processedContent: '## Generation',
				reasoning: 'thinking',
				variables: null,
			});
			cb.onPhaseComplete(
				'CHARACTER_PROFILE_COMPRESSOR',
				{ profileCompressionLog: '## Generation\n\n## Applied updates\n\n### Elena Vale', profileMarkdownOutput: '# Profile Updates' },
				{
					finishReason: 'stop',
					usage: { inputTokens: 15, outputTokens: 4, totalTokens: 19 },
					durationMs: 3,
					models: new Set(['sum-model']),
				}
			);
			return { state: { editorOutput: 'prose' }, phases: [], backgroundPhases: Promise.resolve({}) };
		});

		let resolveBackgroundSettled!: () => void;
		const backgroundSettled = new Promise<void>((r) => (resolveBackgroundSettled = r));
		const off = subscribeRuns((e) => {
			if (e.type === 'background-settled') resolveBackgroundSettled();
		});

		await startMainRun({ actLineId: 'line-1', message: 'go' });
		await backgroundSettled;
		off();

		const backgroundUpsert = vi.mocked(dbMessagePhases.upsertMessagePhases).mock.calls.at(-1)!;
		const successRow = backgroundUpsert[1].find((p) => p.phaseName === 'CHARACTER_PROFILE_COMPRESSOR');
		expect(successRow?.content).toBe('# Profile Updates');
		expect(successRow?.processedContent).toBe('## Generation\n\n## Applied updates\n\n### Elena Vale');
		const persisted = JSON.parse(vi.mocked(updatePersistentMessageMetadata).mock.calls.at(-1)![1].metadata!);
		expect(persisted.phases.find((p: { phaseName: string }) => p.phaseName === 'CHARACTER_PROFILE_COMPRESSOR').inputTokens).toBe(15);
	});

	it('persists a failed compressor entry, terminal log and usage after background settle', async () => {
		// WHY: a compressor failure must survive reload exactly like a success; the
		// retained chip content and the usage already spent are persisted at settle.
		const compressorMeta = {
			finishReason: 'stop',
			usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
			durationMs: 2,
			models: new Set(['sum-model']),
		};
		vi.mocked(runPipeline).mockImplementation(async (input) => {
			const cb = input.execution.callbacks;
			cb.onPhaseStart('EDITOR');
			cb.onPhaseComplete('EDITOR', { editorOutput: 'final prose', editorReasoning: 'thoughts' });
			cb.onPhaseStart('SUMMARIZER');
			cb.onPhaseComplete(
				'SUMMARIZER',
				{ actSummary: 'the summary' },
				{
					finishReason: 'stop',
					usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
					durationMs: 1,
					models: new Set(['sum-model']),
				}
			);
			cb.onPhaseStart('CHARACTER_PROFILE_COMPRESSOR');
			cb.onPhaseStream('CHARACTER_PROFILE_COMPRESSOR', {
				content: '# Profile Updates',
				processedContent: '## Generation',
				reasoning: 'thinking',
				variables: null,
			});
			cb.onPhaseFailed?.('CHARACTER_PROFILE_COMPRESSOR', {
				profileCompressionLog: '## Generation\n\n## Failed\n\ncheckpoint down',
				profileMarkdownOutput: '# Profile Updates',
				metadata: compressorMeta,
			});
			return {
				state: { editorOutput: 'final prose' },
				phases: [],
				backgroundPhases: Promise.resolve({ actSummary: 'the summary' }),
			};
		});

		let resolveBackgroundSettled!: () => void;
		const backgroundSettled = new Promise<void>((r) => (resolveBackgroundSettled = r));
		const off = subscribeRuns((e) => {
			if (e.type === 'background-settled') resolveBackgroundSettled();
		});

		const { assistantMessage } = await startMainRun({ actLineId: 'line-1', message: 'go' });
		await backgroundSettled;
		off();

		const backgroundUpsert = vi.mocked(dbMessagePhases.upsertMessagePhases).mock.calls.at(-1)!;
		expect(backgroundUpsert[0]).toBe(assistantMessage.id);
		const compressorRow = backgroundUpsert[1].find((p) => p.phaseName === 'CHARACTER_PROFILE_COMPRESSOR');
		expect(compressorRow?.content).toBe('# Profile Updates');
		expect(compressorRow?.processedContent).toBe('## Generation\n\n## Failed\n\ncheckpoint down');

		const metadataUpdates = vi.mocked(updatePersistentMessageMetadata).mock.calls.at(-1)!;
		const persisted = JSON.parse(metadataUpdates[1].metadata!);
		expect(persisted.phases.map((p: { phaseName: string }) => p.phaseName)).toEqual(['SUMMARIZER', 'CHARACTER_PROFILE_COMPRESSOR']);
		expect(persisted.inputTokens).toBe(30);
		expect(persisted.phases.find((p: { phaseName: string }) => p.phaseName === 'CHARACTER_PROFILE_COMPRESSOR').inputTokens).toBe(20);
		expect(getActiveSession('line-1')).toBeUndefined();
	});

	it('skips the background cache report when no background phase metadata landed', async () => {
		// WHY: the report is guarded on non-empty background entries — a chain that
		// lands without phase metadata (or an epilogue, which has no background chain)
		// must not emit an empty report.
		vi.mocked(runPipeline).mockImplementation(async (input) => {
			const cb = input.execution.callbacks;
			cb.onPhaseStart('EDITOR');
			cb.onPhaseComplete('EDITOR', { editorOutput: 'prose' });
			return { state: { editorOutput: 'prose' }, phases: [], backgroundPhases: Promise.resolve({}) };
		});

		let resolveBackgroundSettled!: () => void;
		const backgroundSettled = new Promise<void>((r) => (resolveBackgroundSettled = r));
		const off = subscribeRuns((e) => {
			if (e.type === 'background-settled') resolveBackgroundSettled();
		});

		await startMainRun({ actLineId: 'line-1', message: 'go' });
		await backgroundSettled;
		off();

		const cacheLogs = vi.mocked(fileLog).mock.calls.filter((c) => c[1] === 'pipeline-cache');
		expect(cacheLogs.length).toBe(1);
	});
});

describe('background session reachability', () => {
	beforeEach(() => {
		settingsMock.reviewerEnabled = false;
	});

	function mockRunWithDeferredBackground() {
		let resolveBackground!: (v: { actSummary?: string }) => void;
		const backgroundPhases = new Promise<{ actSummary?: string }>((r) => (resolveBackground = r));
		let capturedSignal: AbortSignal | undefined;
		vi.mocked(runPipeline).mockImplementation(async (input) => {
			capturedSignal = input.execution.abortSignal;
			const cb = input.execution.callbacks;
			cb.onPhaseStart('EDITOR');
			cb.onPhaseComplete('EDITOR', { editorOutput: 'prose' });
			cb.onPhaseStart('SUMMARIZER');
			return { state: { editorOutput: 'prose' }, phases: [], backgroundPhases };
		});
		return { resolveBackground: () => resolveBackground({ actSummary: 's' }), getSignal: () => capturedSignal };
	}

	it('getActiveSession falls back to the background session after main settle', async () => {
		// WHY: spinners and re-attach must keep working while the background chain
		// runs after the main run has settled and unregistered.
		const { resolveBackground } = mockRunWithDeferredBackground();
		const events: RunEvent[] = [];
		let resolveSettled!: () => void;
		let resolveBackgroundSettled!: () => void;
		const settled = new Promise<void>((r) => (resolveSettled = r));
		const backgroundSettled = new Promise<void>((r) => (resolveBackgroundSettled = r));
		const off = subscribeRuns((e) => {
			events.push(e);
			if (e.type === 'settled') resolveSettled();
			if (e.type === 'background-settled') resolveBackgroundSettled();
		});

		await startMainRun({ actLineId: 'line-1', message: 'go' });
		await settled;

		const view = getActiveSession('line-1');
		expect(view).toBeDefined();
		expect(view?.streamingPhases).toEqual(['SUMMARIZER']);

		resolveBackground();
		await backgroundSettled;
		expect(getActiveSession('line-1')).toBeUndefined();
		off();
	});

	it('abortRun aborts the background chain when no live run is running', async () => {
		// WHY: Stop must cover visible background phases (design D3).
		const { resolveBackground, getSignal } = mockRunWithDeferredBackground();
		let resolveSettled!: () => void;
		const settled = new Promise<void>((r) => (resolveSettled = r));
		const off = subscribeRuns((e) => {
			if (e.type === 'settled') resolveSettled();
		});

		await startMainRun({ actLineId: 'line-1', message: 'go' });
		await settled;
		expect(getSignal()?.aborted).toBe(false);

		abortRun('line-1');
		expect(getSignal()?.aborted).toBe(true);

		resolveBackground();
		off();
	});
});
