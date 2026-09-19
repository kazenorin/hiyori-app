import { describe, it, expect, vi, beforeEach } from 'vitest';

const flags = vi.hoisted(() => ({
	reviewerEnabled: true,
	quickReview: false,
	plotPlannerEnabled: true,
	reevalFrequency: 5,
}));

vi.mock('$lib/localization', () => ({
	ls: (key: string) => key,
	t: (key: string) => key,
}));

vi.mock('$lib/stores/settings.svelte', () => ({
	isReviewerEnabled: () => flags.reviewerEnabled,
	isQuickReview: () => flags.quickReview,
	isPlotPlannerEnabled: () => flags.plotPlannerEnabled,
	getReevaluationFrequency: () => flags.reevalFrequency,
	isMemoryAvailable: () => false,
	isInventoryAvailable: () => false,
	isPhraseHighlightingEnabled: () => false,
}));

vi.mock('$lib/logging/logger', () => ({
	log: { info: vi.fn(async () => {}), error: vi.fn(async () => {}), warn: vi.fn(async () => {}), debug: vi.fn(async () => {}) },
	fileLog: vi.fn(async () => {}),
}));

vi.mock('$lib/ai/tools/tools', () => ({
	guardToolsForPhase: (tools: unknown) => tools,
}));

vi.mock('$lib/ai/reviewer-output-parser', () => ({
	reviewerAcceptsAsIs: vi.fn(() => false),
}));

vi.mock('$lib/ai/pipeline/phase-executor', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/ai/pipeline/phase-executor')>();
	return { ...actual, executeStreamingPhase: vi.fn() };
});

import { executeStreamingPhase } from '$lib/ai/pipeline/phase-executor';
import { aggregateMetadataFromPhases } from '$lib/ai/pipeline/phase-executor';
import { runReviewerEditorPhases, runGamePhases, type PipelineRunContext, type TrackPhase } from '$lib/ai/pipeline/runners';
import { reviewerAcceptsAsIs } from '$lib/ai/reviewer-output-parser';
import type { PipelineState } from '$lib/ai/pipeline/types';
import type { StreamResultMetadata } from '$lib/ai/streaming';
import type { PhaseMetadata } from '$lib/ai/chat-stream';
import type { ActLineContext } from '$lib/ai/pipeline/types';
import { createNarrativeOverrides } from '$lib/ai/narrative-types';

const executeStreamingPhaseMock = vi.mocked(executeStreamingPhase);
const reviewerAcceptsAsIsMock = vi.mocked(reviewerAcceptsAsIs);

function makeMetadata(): StreamResultMetadata {
	return {
		finishReason: 'stop',
		usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
		durationMs: 10,
		models: new Set(['m']),
	};
}

/** Mock implementation: patches state per phase and records which phases ran. */
function mockPhases(patches: Record<string, Partial<PipelineState>>): string[] {
	const ranPhases: string[] = [];
	executeStreamingPhaseMock.mockImplementation(async (params, state) => {
		ranPhases.push(params.phaseName);
		return {
			state: { ...state, ...(patches[params.phaseName] ?? {}) },
			streamState: { content: '', reasoning: null, variables: null },
			metadata: makeMetadata(),
		};
	});
	return ranPhases;
}

function makeActLine(overrides: Partial<ActLineContext> = {}): ActLineContext {
	return {
		id: 'line-1',
		actId: 'act-1',
		name: 'Main Line',
		isMainLine: true,
		createdAt: 0,
		plotMode: 'guidance',
		currentActPhase: null,
		actPhaseBoundaries: [],
		lastPlotGeneration: null,
		actNumber: 1,
		currentActPhaseLengthEstimate: null,
		currentScene: 2,
		...overrides,
	} as ActLineContext;
}

function makeCtx(actLineOverrides: Partial<ActLineContext> = {}, completedScenes = 1): PipelineRunContext {
	return {
		sharedParams: {
			abortSignal: new AbortController().signal,
			callbacks: {
				onPhaseStart: vi.fn(),
				onPhaseStream: vi.fn(),
				onPhaseRetry: vi.fn(),
				onPhaseComplete: vi.fn(),
				onError: vi.fn(),
				onAllComplete: vi.fn(),
			},
			retryConfig: { retryCount: 0, backoffIntervalSeconds: 0 },
		},
		providerConfigs: {
			plotPlanner: undefined,
			writer: undefined,
			reviewer: undefined,
			editor: undefined,
			gameMaster: undefined,
			summarizer: undefined,
			minorTaskAgent: undefined,
		},
		prompts: {
			generalInstructions: '',
			mainChatSystemPrompt: '',
			writerOutputTemplate: '',
			writerRole: '',
			guidanceWriterExtractionPrompt: '',
			phaseEventWriterExtractionPrompt: '',
			epilogueWriterExtractionPrompt: '',
			reviewerExtractionPrompt: '',
			quickReviewerExtractionPrompt: '',
			editorExtractionPrompt: '',
			guidancePlotPlannerExtractionPrompt: '',
			phaseEventPlotPlannerExtractionPrompt: '',
			guidanceGameMasterExtractionPrompt: '',
			phaseEventGameMasterExtractionPrompt: '',
		},
		effectiveTargetWordCount: '400',
		currentScene: String(completedScenes + 1),
		completedScenes,
		directorNotes: '',
		// runGamePhases carry-forward reads previousScenePlot; other gates ignore content.
		previousScenePlot: 'previous plot',
		tools: undefined,
		story: { storyId: 'story-1', storyName: 'Story', actLine: makeActLine(actLineOverrides) },
		assistant: { messageId: 'msg-1', messageSequence: 1 },
		narrativeOverrides: createNarrativeOverrides(),
		context: {
			worldContent: '',
			actPlot: '',
			previousActSummaries: [],
			summarizationPoint: 0,
			characterProfiles: [],
			actSummaryAtSP: '',
			scenesSections: [],
		},
	};
}

function makeTrackPhase(): { trackPhase: TrackPhase; tracked: string[] } {
	const tracked: string[] = [];
	const trackPhase: TrackPhase = (phaseName, result) => {
		tracked.push(phaseName);
		return result.state;
	};
	return { trackPhase, tracked };
}

beforeEach(() => {
	vi.clearAllMocks();
	flags.reviewerEnabled = true;
	flags.quickReview = false;
	flags.plotPlannerEnabled = true;
	flags.reevalFrequency = 5;
	reviewerAcceptsAsIsMock.mockReturnValue(false);
});

describe('aggregateMetadataFromPhases', () => {
	const entry = (over: Partial<PhaseMetadata> = {}): PhaseMetadata => ({
		phaseName: 'WRITER',
		model: 'model-a',
		finishReason: 'stop',
		inputTokens: 10,
		outputTokens: 20,
		totalTokens: 30,
		durationMs: 100,
		...over,
	});

	it('returns undefined for an empty list', () => {
		expect(aggregateMetadataFromPhases([])).toBeUndefined();
	});

	it('sums usage and duration across phases and keeps the last finish reason', () => {
		const result = aggregateMetadataFromPhases([
			entry({ phaseName: 'WRITER', finishReason: 'length' }),
			entry({ phaseName: 'EDITOR', model: 'model-b', finishReason: 'stop', cacheReadTokens: 5 }),
		]);
		expect(result).toBeDefined();
		expect(result!.usage.inputTokens).toBe(20);
		expect(result!.usage.outputTokens).toBe(40);
		expect(result!.usage.totalTokens).toBe(60);
		expect(result!.durationMs).toBe(200);
		expect(result!.finishReason).toBe('stop');
		expect(result!.usage.cacheReadTokens).toBe(5);
		expect([...result!.models].sort()).toEqual(['model-a', 'model-b']);
	});

	it('omits unknown models and undefined cache tokens', () => {
		const result = aggregateMetadataFromPhases([entry({ model: 'unknown' })]);
		expect(result!.models.size).toBe(0);
		expect(result!.usage.cacheReadTokens).toBeUndefined();
	});
});

describe('runReviewerEditorPhases resume gates', () => {
	it('runs reviewer and editor on a fresh run', async () => {
		const ran = mockPhases({ REVIEWER: { reviewerOutput: 'review' }, EDITOR: { editorOutput: 'edited', editorVariables: null } });
		const { trackPhase, tracked } = makeTrackPhase();
		const state: PipelineState = { writerOutput: 'draft' };

		const result = await runReviewerEditorPhases(makeCtx(), state, trackPhase);

		expect(ran).toEqual(['REVIEWER', 'EDITOR']);
		expect(tracked).toEqual(['REVIEWER', 'EDITOR']);
		expect(result.editorOutput).toBe('edited');
	});

	it('skips the reviewer when its output is cached, still runs the editor', async () => {
		const ran = mockPhases({ EDITOR: { editorOutput: 'edited' } });
		const { trackPhase, tracked } = makeTrackPhase();
		const state: PipelineState = { writerOutput: 'draft', reviewerOutput: 'cached review' };

		const result = await runReviewerEditorPhases(makeCtx(), state, trackPhase);

		expect(ran).toEqual(['EDITOR']);
		expect(tracked).toEqual(['EDITOR']);
		expect(result.editorOutput).toBe('edited');
		expect(result.reviewerOutput).toBe('cached review');
	});

	it('skips both phases when the editor output is cached', async () => {
		const ran = mockPhases({});
		const { trackPhase } = makeTrackPhase();
		const state: PipelineState = { writerOutput: 'draft', reviewerOutput: 'review', editorOutput: 'edited' };

		const result = await runReviewerEditorPhases(makeCtx(), state, trackPhase);

		expect(ran).toEqual([]);
		expect(result).toBe(state);
	});

	it('seeds editor from cached writer output when the reviewer is disabled', async () => {
		flags.reviewerEnabled = false;
		const ran = mockPhases({});
		const { trackPhase } = makeTrackPhase();
		const state: PipelineState = { writerOutput: 'draft' };

		const result = await runReviewerEditorPhases(makeCtx(), state, trackPhase);

		expect(ran).toEqual([]);
		expect(result.editorOutput).toBe('draft');
	});

	it('accepts as-is from a cached review without running the editor', async () => {
		reviewerAcceptsAsIsMock.mockReturnValue(true);
		const ran = mockPhases({});
		const { trackPhase } = makeTrackPhase();
		const state: PipelineState = { writerOutput: 'draft', reviewerOutput: 'accept as-is review' };

		const result = await runReviewerEditorPhases(makeCtx(), state, trackPhase);

		expect(ran).toEqual([]);
		expect(result.editorOutput).toBe('draft');
		expect(result.editorReasoning).toBeNull();
	});
});

describe('runGamePhases resume gates', () => {
	it('runs GM and Plot Planner concurrently on a fresh run', async () => {
		const ran = mockPhases({ GAME_MASTER: { gameMasterOutput: 'gm' }, PLOT_PLANNER: { scenePlot: 'next plot' } });
		const { trackPhase, tracked } = makeTrackPhase();

		const result = await runGamePhases(makeCtx(), {}, trackPhase);

		expect(ran.sort()).toEqual(['GAME_MASTER', 'PLOT_PLANNER']);
		expect(tracked.sort()).toEqual(['GAME_MASTER', 'PLOT_PLANNER']);
		expect(result.scenePlot).toBe('next plot');
	});

	it('keeps the completed concurrent phase cached when its sibling fails', async () => {
		executeStreamingPhaseMock.mockImplementation(async (params) => {
			if (params.phaseName === 'GAME_MASTER') throw new Error('gm provider down');
			return {
				state: { scenePlot: 'planned anyway' },
				streamState: { content: '', reasoning: null, variables: null },
				metadata: makeMetadata(),
			};
		});
		const { trackPhase, tracked } = makeTrackPhase();

		await expect(runGamePhases(makeCtx(), {}, trackPhase)).rejects.toThrow('gm provider down');
		// The Plot Planner finished before the GM failed; its commit must not be lost.
		expect(tracked).toContain('PLOT_PLANNER');
		expect(tracked).not.toContain('GAME_MASTER');
	});

	it('runs GM only and carries forward the previous plot when the re-evaluation frequency has not elapsed', async () => {
		const ran = mockPhases({ GAME_MASTER: { gameMasterOutput: 'gm' } });
		const { trackPhase } = makeTrackPhase();
		// phaseEvent mode with a recent plot generation: planner must not run
		const ctx = makeCtx({ plotMode: 'phaseEvent', lastPlotGeneration: 1 }, 2);

		const result = await runGamePhases(ctx, {}, trackPhase);

		expect(ran).toEqual(['GAME_MASTER']);
		expect(result.scenePlot).toBe('previous plot');
	});

	it('leaves scenePlot undefined when the Plot Planner is disabled', async () => {
		flags.plotPlannerEnabled = false;
		const ran = mockPhases({ GAME_MASTER: { gameMasterOutput: 'gm' } });
		const { trackPhase } = makeTrackPhase();

		const result = await runGamePhases(makeCtx(), {}, trackPhase);

		expect(ran).toEqual(['GAME_MASTER']);
		expect(result.scenePlot).toBeUndefined();
	});

	it('runs only the Plot Planner when GM output is cached (resume)', async () => {
		const ran = mockPhases({ PLOT_PLANNER: { scenePlot: 'next plot' } });
		const { trackPhase, tracked } = makeTrackPhase();
		const state: PipelineState = { gameMasterOutput: 'cached gm' };

		const result = await runGamePhases(makeCtx(), state, trackPhase);

		expect(ran).toEqual(['PLOT_PLANNER']);
		expect(tracked).toEqual(['PLOT_PLANNER']);
		expect(result.gameMasterOutput).toBe('cached gm');
		expect(result.scenePlot).toBe('next plot');
	});

	it('carries forward the plot on resume when GM is cached but the re-evaluation frequency has not elapsed', async () => {
		const ran = mockPhases({});
		const { trackPhase } = makeTrackPhase();
		const ctx = makeCtx({ plotMode: 'phaseEvent', lastPlotGeneration: 1 }, 2);
		const state: PipelineState = { gameMasterOutput: 'cached gm' };

		const result = await runGamePhases(ctx, state, trackPhase);

		expect(ran).toEqual([]);
		expect(result.scenePlot).toBe('previous plot');
	});

	it('leaves scenePlot undefined on resume when GM is cached and the Plot Planner is disabled', async () => {
		flags.plotPlannerEnabled = false;
		const ran = mockPhases({});
		const { trackPhase } = makeTrackPhase();
		const state: PipelineState = { gameMasterOutput: 'cached gm' };

		const result = await runGamePhases(makeCtx(), state, trackPhase);

		expect(ran).toEqual([]);
		expect(result.scenePlot).toBeUndefined();
	});

	it('keeps the carried-forward empty plot on resume instead of re-running the planner', async () => {
		const ran = mockPhases({});
		const { trackPhase } = makeTrackPhase();
		// GM-only run cached scenePlot = '' (carry-forward); planner must not run again
		const state: PipelineState = { gameMasterOutput: 'cached gm', scenePlot: '' };

		const result = await runGamePhases(makeCtx(), state, trackPhase);

		expect(ran).toEqual([]);
		expect(result).toBe(state);
	});

	it('skips everything when both outputs are cached', async () => {
		const ran = mockPhases({});
		const { trackPhase } = makeTrackPhase();
		const state: PipelineState = { gameMasterOutput: 'gm', scenePlot: 'plot' };

		const result = await runGamePhases(makeCtx(), state, trackPhase);

		expect(ran).toEqual([]);
		expect(result).toBe(state);
	});
});
