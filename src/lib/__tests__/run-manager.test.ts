import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/stores/settings.svelte', () => ({
	settings: { targetWordCount: 400, importantPhraseHighlighting: false },
	getDefaultPlotMode: () => 'guidance',
	getMainProviderConfig: () => ({ id: 'main', model: 'test-model', apiKey: 'k' }),
	getSummarizerProviderConfig: () => ({ id: 'sum', model: 'sum-model', apiKey: 'k' }),
	isDirectorModeEnabled: () => false,
}));

vi.mock('$lib/logging/logger', () => ({
	log: { info: vi.fn(async () => {}), error: vi.fn(async () => {}), warn: vi.fn(async () => {}), debug: vi.fn(async () => {}) },
	fileLog: vi.fn(async () => {}),
}));

vi.mock('$lib/logging/chat-logger', () => ({ logMainChat: vi.fn(async () => {}) }));
vi.mock('$lib/ai/pipeline', () => ({ runPipeline: vi.fn(), runEpiloguePipeline: vi.fn() }));
vi.mock('$lib/ai/world-generator', () => ({ ensureWorldFile: vi.fn(async () => 'world') }));
vi.mock('$lib/ai/act-plot', () => ({ ensureActPlot: vi.fn(async () => 'plot') }));
vi.mock('$lib/localization', () => ({ loadLocaleStrings: vi.fn(async () => {}), ls: (k: string) => k }));
vi.mock('$lib/fs/prompt-loader', () => ({ setActiveLocale: vi.fn() }));
vi.mock('$lib/ai/chat/persistence', () => ({
	loadActLineMessagesFromDB: vi.fn(async () => []),
	persistMessage: vi.fn(async () => {}),
	persistUserMessage: vi.fn(async () => ({ id: 'user-1', role: 'user', content: 'hi', sceneNumber: 0 })),
	updateLastPlotGeneration: vi.fn(async () => {}),
	updatePersistentMessageMetadata: vi.fn(async () => {}),
}));

import { draftMessageFromRecord } from '$lib/ai/chat/run-manager';
import type { PipelineRunRecord } from '$lib/db/pipeline-runs';
import type { GameDataFields, NarrativeVariables } from '$lib/ai/narrative-types';

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
		expect(draft.phases?.map((p) => p.phaseName)).toEqual(['WRITER', 'REVIEWER']);
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
		expect(draft.phases?.map((p) => p.phaseName)).toEqual(['WRITER', 'GAME_MASTER', 'PLOT_PLANNER']);
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
