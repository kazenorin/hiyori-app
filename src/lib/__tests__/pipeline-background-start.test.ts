import { describe, it, expect, vi, beforeEach } from 'vitest';

// Provider prompt caches are only populated once a request completes, so a background
// chain started concurrently with the Writer misses the shared Tier 0–2 prefix cache.
// These tests pin the ordering: background must not start until the Writer completes.

const order: string[] = [];
let writerDeferred: { promise: Promise<void>; resolve: () => void };
let writerBehavior: 'resolve' | 'throw' = 'resolve';

vi.mock('#lib/localization/index.ts', () => ({ ls: (k: string) => k, t: (k: string) => k }));
vi.mock('#lib/logging/logger.ts', () => ({
	log: { info: vi.fn(async () => {}), error: vi.fn(async () => {}), warn: vi.fn(async () => {}), debug: vi.fn(async () => {}) },
	fileLog: vi.fn(async () => {}),
}));
vi.mock('#lib/stores/settings.svelte.ts', () => ({
	isReviewerEnabled: () => true,
	isQuickReview: () => false,
	isPlotPlannerEnabled: () => true,
	getReevaluationFrequency: () => 5,
	isMemoryAvailable: () => false,
	isInventoryAvailable: () => false,
	isPhraseHighlightingEnabled: () => false,
}));
vi.mock('#lib/ai/chat/pipeline-config.ts', () => ({ buildPipelineProviderConfigs: () => ({}) }));
vi.mock('#lib/ai/tools/tools.ts', () => ({ buildTools: vi.fn(async () => ({})) }));
vi.mock('#lib/ai/pipeline/prompt-loader.ts', () => ({
	loadPrompts: vi.fn(async () => new Proxy({}, { get: () => '' })),
}));
vi.mock('#lib/ai/pipeline/phase-executor.ts', () => ({
	aggregateMetadata: (_a: unknown, b: unknown) => b,
	aggregateMetadataFromPhases: () => undefined,
}));

vi.mock('#lib/ai/pipeline/runners.ts', () => ({
	defaultTargetWordCount: 400,
	getEndingLabel: () => 'ending',
	maybeExtractImportantPhrases: vi.fn(),
	runWriterPhase: vi.fn(async (_ctx: unknown, state: Record<string, unknown>) => {
		order.push('writer-start');
		await writerDeferred.promise;
		if (writerBehavior === 'throw') throw new Error('writer provider down');
		order.push('writer-end');
		return { ...state, writerOutput: 'draft' };
	}),
	runReviewerEditorPhases: vi.fn(async (_ctx: unknown, state: Record<string, unknown>) => {
		order.push('reviewer-editor');
		return { ...state, editorOutput: 'edited' };
	}),
	runEditorTemplateFitter: vi.fn(async (_ctx: unknown, state: Record<string, unknown>) => state),
	runGamePhases: vi.fn(async (_ctx: unknown, state: Record<string, unknown>) => {
		order.push('game');
		return { ...state, gameMasterOutput: 'gm', scenePlot: 'plot' };
	}),
	runGmTemplateFitter: vi.fn(async (_ctx: unknown, state: Record<string, unknown>) => state),
}));

vi.mock('#lib/ai/pipeline/summarizer.ts', () => ({
	runBackgroundPhases: vi.fn(async () => {
		order.push('background-start');
		return {};
	}),
}));

import { runPipeline } from '#lib/ai/pipeline/index.ts';
import { runBackgroundPhases } from '#lib/ai/pipeline/summarizer.ts';
import { runWriterPhase } from '#lib/ai/pipeline/runners.ts';
import type { PipelineInput } from '#lib/ai/pipeline/types.ts';

const runBackgroundPhasesMock = vi.mocked(runBackgroundPhases);
const runWriterPhaseMock = vi.mocked(runWriterPhase);

function makeInput(initialState?: Record<string, unknown>): PipelineInput {
	return {
		execution: {
			abortSignal: new AbortController().signal,
			callbacks: {
				onPhaseStart: vi.fn(),
				onPhaseStream: vi.fn(),
				onPhaseRetry: vi.fn(),
				onPhaseComplete: vi.fn(),
				onError: vi.fn(),
				onAllComplete: vi.fn(),
			},
		},
		story: { storyId: 'story-1', storyName: 'Story', actLine: { id: 'line-1' } },
		assistant: { messageId: 'msg-1', messageSequence: 1 },
		completedScenes: 15,
		player: { playerResponse: 'continue', playerMessageId: 'player-1' },
		context: {},
		initialState,
	} as unknown as PipelineInput;
}

/** Flush pending microtasks so started-but-unawaited phases register their order. */
async function flush(): Promise<void> {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
	order.length = 0;
	writerBehavior = 'resolve';
	writerDeferred = (() => {
		let resolve!: () => void;
		const promise = new Promise<void>((r) => (resolve = r));
		return { promise, resolve };
	})();
	vi.clearAllMocks();
});

describe('runPipeline background-phase start ordering', () => {
	it('does not start the background chain until the Writer completes', async () => {
		const run = runPipeline(makeInput());
		await flush();
		expect(order).toContain('writer-start');
		expect(order).not.toContain('writer-end');
		expect(runBackgroundPhasesMock).not.toHaveBeenCalled();

		writerDeferred.resolve();
		await flush();
		expect(order).toContain('writer-end');
		expect(runBackgroundPhasesMock).toHaveBeenCalledTimes(1);
		expect(order.indexOf('background-start')).toBeGreaterThan(order.indexOf('writer-end'));

		await run;
		expect(order.indexOf('background-start')).toBeLessThan(order.indexOf('reviewer-editor'));
	});

	it('starts the background chain immediately when the Writer output is cached (resume)', async () => {
		const run = runPipeline(makeInput({ writerOutput: 'cached draft' }));
		await flush();
		expect(runWriterPhaseMock).not.toHaveBeenCalled();
		expect(runBackgroundPhasesMock).toHaveBeenCalledTimes(1);
		await run;
		expect(order.indexOf('background-start')).toBeLessThan(order.indexOf('reviewer-editor'));
	});

	it('does not start the background chain when the Writer fails', async () => {
		writerBehavior = 'throw';
		const run = runPipeline(makeInput());
		writerDeferred.resolve();
		await expect(run).rejects.toThrow('writer provider down');
		expect(runBackgroundPhasesMock).not.toHaveBeenCalled();
	});
});
