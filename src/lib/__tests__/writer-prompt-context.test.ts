import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/localization', () => ({
	ls: (key: string, params?: Record<string, string | number>) => (params ? `${key} ${JSON.stringify(params)}` : key),
	t: (key: string) => key,
}));

vi.mock('$lib/stores/settings.svelte', () => ({
	isReviewerEnabled: () => true,
	isQuickReview: () => false,
	isPlotPlannerEnabled: () => true,
	getReevaluationFrequency: () => 5,
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

vi.mock('$lib/ai/pipeline/phase-executor', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/ai/pipeline/phase-executor')>();
	return { ...actual, executeStreamingPhase: vi.fn() };
});

import { executeStreamingPhase } from '$lib/ai/pipeline/phase-executor';
import { runWriterPhase, type PipelineRunContext, type TrackPhase } from '$lib/ai/pipeline/runners';
import type { ActLineContext, PipelineState } from '$lib/ai/pipeline/types';
import type { StreamResultMetadata } from '$lib/ai/streaming';
import { createNarrativeOverrides } from '$lib/ai/narrative-types';

const executeStreamingPhaseMock = vi.mocked(executeStreamingPhase);

function makeMetadata(): StreamResultMetadata {
	return { finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, durationMs: 10, models: new Set(['m']) };
}

/**
 * The prompt must claim the coverage the frozen snapshot actually has — the summarization
 * point — not `completedScenes - 1`. Overstating coverage makes the writer discount the raw
 * Scenes blocks that carry the newer scenes.
 */
function makeCtx(summarizationPoint: number): PipelineRunContext {
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
			guidanceWriterExtractionPrompt: 'TASK[{{providedSummary}}]',
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
		currentScene: '8',
		completedScenes: 7,
		directorNotes: '',
		previousScenePlot: 'previous plot',
		tools: undefined,
		story: {
			storyId: 'story-1',
			storyName: 'Story',
			actLine: {
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
				currentScene: 8,
			} as ActLineContext,
		},
		assistant: { messageId: 'msg-1', messageSequence: 1 },
		narrativeOverrides: createNarrativeOverrides(),
		context: {
			worldContent: '',
			actPlot: '',
			previousActSummaries: [],
			summarizationPoint,
			characterProfiles: [],
			actSummaryAtSP: '',
			scenesSections: [],
			plotMode: 'guidance',
		},
	};
}

/** Render every message the Writer phase receives and return them as one string. */
async function renderWriterMessages(ctx: PipelineRunContext): Promise<string> {
	let rendered = '';
	executeStreamingPhaseMock.mockImplementation(async (params, state) => {
		rendered = params.messages.map((m) => m.content).join('\n---\n');
		return {
			state: { ...state } as PipelineState,
			streamState: { content: '', reasoning: null, variables: null },
			metadata: makeMetadata(),
		};
	});
	const trackPhase: TrackPhase = (_phaseName, result) => result.state;
	await runWriterPhase(ctx, {}, trackPhase);
	return rendered;
}

describe('runWriterPhase — summary coverage claim', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('reports the summarization point, not completedScenes - 1', async () => {
		const rendered = await renderWriterMessages(makeCtx(5));

		// completedScenes is 7, so the old derivation claimed Scene 6.
		expect(rendered).toContain('{"summarizedScenes":5}');
		expect(rendered).not.toContain('{"summarizedScenes":6}');
	});

	it('omits the summary bullet entirely when no summarization point resolved', async () => {
		const rendered = await renderWriterMessages(makeCtx(0));

		// Mirrors buildSummariesMessage(), which omits the # Summaries message when SP is 0.
		expect(rendered).toContain('TASK[]');
		expect(rendered).not.toContain('summarizedScenes');
	});
});
