import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Does not mock `#lib/localization`: assertions compare the injected heading against the real
 * label the parser matches, so `ls()` must return real values (loadLocaleStrings falls back to the
 * bundled YAML under vitest).
 */
vi.mock('#lib/stores/settings.svelte.ts', () => ({
	isReviewerEnabled: () => true,
	isQuickReview: () => false,
	isPlotPlannerEnabled: () => true,
	getReevaluationFrequency: () => 5,
	isMemoryAvailable: () => false,
	isInventoryAvailable: () => false,
	isPhraseHighlightingEnabled: () => false,
}));

vi.mock('#lib/logging/logger.ts', () => ({
	log: { info: vi.fn(async () => {}), error: vi.fn(async () => {}), warn: vi.fn(async () => {}), debug: vi.fn(async () => {}) },
	fileLog: vi.fn(async () => {}),
}));

vi.mock('#lib/ai/tools/tools.ts', () => ({
	guardToolsForPhase: (tools: unknown) => tools,
}));

vi.mock('#lib/ai/pipeline/phase-executor.ts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/ai/pipeline/phase-executor.ts')>();
	return { ...actual, executeStreamingPhase: vi.fn() };
});

import { executeStreamingPhase } from '#lib/ai/pipeline/phase-executor.ts';
import { loadLocaleStrings, ls } from '#lib/localization/index.ts';
import { runGamePhases, type PipelineRunContext, type TrackPhase } from '#lib/ai/pipeline/runners.ts';
import { parseActPhaseLengthEstimate } from '#lib/ai/plot-planner-output-parser.ts';
import type { ActLineContext, PipelineState } from '#lib/ai/pipeline/types.ts';
import type { StreamState } from '#lib/ai/chat-callbacks.ts';
import type { StreamResultMetadata } from '#lib/ai/streaming.ts';
import { createNarrativeOverrides } from '#lib/ai/narrative-types.ts';

const executeStreamingPhaseMock = vi.mocked(executeStreamingPhase);

const LOCALES = ['en', 'zh-Hant-HK'] as const;
type Locale = (typeof LOCALES)[number];

const ESTIMATE_LABEL_KEY = 'pipeline.labels.plotPlanner.estimatedLength';
const ESTIMATE_INSTRUCTION_KEY = 'pipeline.extraction.plotPlanner.estimatedLengthRequirement';

const PLOT_PLANNER_PROMPT_FILES = import.meta.glob('../fs/*/prompts/plot-planner/*.md', {
	eager: true,
	query: '?raw',
	import: 'default',
}) as Record<string, string>;

function promptFile(locale: Locale, name: string): string {
	const key = `../fs/${locale}/prompts/plot-planner/${name}.md`;
	const text = PLOT_PLANNER_PROMPT_FILES[key];
	if (text === undefined) throw new Error(`bundled plot planner prompt not found: ${key}`);
	return text;
}

function makeMetadata(): StreamResultMetadata {
	return { finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, durationMs: 10, models: new Set(['m']) };
}

function makeCtx(locale: Locale, plotMode: 'guidance' | 'phaseEvent'): PipelineRunContext {
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
			reviewerExtractionPrompt: '',
			quickReviewerExtractionPrompt: '',
			editorExtractionPrompt: '',
			guidancePlotPlannerExtractionPrompt: promptFile(locale, 'guidance-plot-planner-prompt'),
			phaseEventPlotPlannerExtractionPrompt: promptFile(locale, 'phase-event-plot-planner-prompt'),
			guidanceGameMasterExtractionPrompt: '',
			phaseEventGameMasterExtractionPrompt: '',
			writerRole: '',
			guidanceWriterExtractionPrompt: '',
			phaseEventWriterExtractionPrompt: '',
			epilogueWriterExtractionPrompt: '',
			writerOutputTemplate: '',
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
				plotMode,
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
			summarizationPoint: 0,
			characterProfiles: [],
			actSummaryAtSP: '',
			scenesSections: [],
			plotMode,
		},
		compression: { completedScenes: 7, newActSummary: undefined, attemptCount: 0, successCount: 0 },
	};
}

interface CapturedPhase {
	extractionPrompt: string;
	buildStateUpdate: (ss: StreamState) => Partial<PipelineState>;
}

/** Drive the real Plot Planner wiring; GM output is pre-seeded so only the planner runs. */
async function capturePlannerPhase(locale: Locale, plotMode: 'guidance' | 'phaseEvent'): Promise<CapturedPhase> {
	let captured: CapturedPhase | null = null;
	executeStreamingPhaseMock.mockImplementation(async (params, state) => {
		const messages = params.messages as { content: string }[];
		captured = {
			extractionPrompt: messages[messages.length - 1].content,
			buildStateUpdate: params.buildStateUpdate as CapturedPhase['buildStateUpdate'],
		};
		return {
			state: { ...state, scenePlot: 'planner output' } as PipelineState,
			streamState: { content: '', reasoning: null, variables: null },
			metadata: makeMetadata(),
		};
	});
	const trackPhase: TrackPhase = (_phaseName, result) => result.state;
	await runGamePhases(makeCtx(locale, plotMode), { gameMasterOutput: 'gm done' }, trackPhase);
	if (!captured) throw new Error('Plot Planner phase did not run');
	return captured;
}

function countOccurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

function normalize(buildStateUpdate: CapturedPhase['buildStateUpdate'], content: string): string {
	const update = buildStateUpdate({ content, reasoning: null, variables: null } as StreamState);
	if (typeof update.scenePlot !== 'string') throw new Error('expected scenePlot in state update');
	return update.scenePlot;
}

describe('plot planner estimate requirement injection', () => {
	beforeEach(async () => {
		executeStreamingPhaseMock.mockReset();
		await loadLocaleStrings('en');
	});

	it.each(LOCALES)('%s: phaseEvent prompt ends with the code-owned requirement section', async (locale) => {
		await loadLocaleStrings(locale);
		const { extractionPrompt } = await capturePlannerPhase(locale, 'phaseEvent');
		const heading = `## ${ls(ESTIMATE_LABEL_KEY)}`;
		const instruction = ls(ESTIMATE_INSTRUCTION_KEY);
		expect(instruction.length).toBeGreaterThan(0);
		expect(extractionPrompt).toContain(`${heading}\n\n${instruction}`);
		expect(extractionPrompt.trimEnd().endsWith(instruction.trimEnd())).toBe(true);
	});

	it.each(LOCALES)('%s: the injected heading is the one the parser matches', async (locale) => {
		await loadLocaleStrings(locale);
		const { extractionPrompt } = await capturePlannerPhase(locale, 'phaseEvent');
		expect(parseActPhaseLengthEstimate(`${extractionPrompt}\n\n7`)).toBe(7);
		expect(extractionPrompt.trimEnd().endsWith('```')).toBe(false);
	});

	it.each(LOCALES)('%s: injection is unconditional even when a stale template copy still asks', async (locale) => {
		await loadLocaleStrings(locale);
		const heading = `## ${ls(ESTIMATE_LABEL_KEY)}`;
		const ctx = makeCtx(locale, 'phaseEvent');
		ctx.prompts.phaseEventPlotPlannerExtractionPrompt += `\n${heading}\n\n[old seeded instruction]\n`;
		let prompt = '';
		executeStreamingPhaseMock.mockImplementation(async (params, state) => {
			const messages = params.messages as { content: string }[];
			prompt = messages[messages.length - 1].content;
			return {
				state: { ...state, scenePlot: 'x' } as PipelineState,
				streamState: { content: '', reasoning: null, variables: null },
				metadata: makeMetadata(),
			};
		});
		const trackPhase: TrackPhase = (_phaseName, result) => result.state;
		await runGamePhases(ctx, { gameMasterOutput: 'gm done' }, trackPhase);
		expect(prompt.trimEnd().endsWith(ls(ESTIMATE_INSTRUCTION_KEY).trimEnd())).toBe(true);
	});

	it.each(LOCALES)('%s: guidance prompt gets no estimate requirement', async (locale) => {
		await loadLocaleStrings(locale);
		const { extractionPrompt } = await capturePlannerPhase(locale, 'guidance');
		expect(extractionPrompt).not.toContain(ls(ESTIMATE_LABEL_KEY));
	});

	it.each(LOCALES)('%s: bundled phaseEvent template no longer hardcodes the section', async (locale) => {
		await loadLocaleStrings(locale);
		const template = promptFile(locale, 'phase-event-plot-planner-prompt');
		const heading = `## ${ls(ESTIMATE_LABEL_KEY)}`;
		expect(countOccurrences(template, heading)).toBe(0);
	});
});

describe('plot planner output normalization', () => {
	beforeEach(async () => {
		executeStreamingPhaseMock.mockReset();
		await loadLocaleStrings('en');
	});

	it('missing section gets the default estimate appended', async () => {
		const { buildStateUpdate } = await capturePlannerPhase('en', 'phaseEvent');
		const result = normalize(buildStateUpdate, '## Standalone Events\n\n- **Event:** something');
		expect(parseActPhaseLengthEstimate(result)).toBe(2);
		expect(result.endsWith(`## ${ls(ESTIMATE_LABEL_KEY)}\n\n2`)).toBe(true);
	});

	it('a valid estimate is preserved under the canonical heading', async () => {
		const { buildStateUpdate } = await capturePlannerPhase('en', 'phaseEvent');
		const result = normalize(buildStateUpdate, 'Plot prose.\n\n## Estimated length\n\n7');
		expect(parseActPhaseLengthEstimate(result)).toBe(7);
		expect(countOccurrences(result, `## ${ls(ESTIMATE_LABEL_KEY)}`)).toBe(1);
	});

	it('out-of-range values fall back to the default', async () => {
		const { buildStateUpdate } = await capturePlannerPhase('en', 'phaseEvent');
		const result = normalize(buildStateUpdate, 'Plot prose.\n\n## Estimated length\n\n9999');
		expect(parseActPhaseLengthEstimate(result)).toBe(2);
	});

	it('duplicate sections collapse to one keeping the first value', async () => {
		const { buildStateUpdate } = await capturePlannerPhase('en', 'phaseEvent');
		const input = 'Plot prose.\n\n## Estimated length\n\n5\n\n## Estimated length\n\n9';
		const result = normalize(buildStateUpdate, input);
		expect(countOccurrences(result, `## ${ls(ESTIMATE_LABEL_KEY)}`)).toBe(1);
		expect(parseActPhaseLengthEstimate(result)).toBe(5);
	});

	it('a non-canonical label is rewritten to the canonical heading', async () => {
		const { buildStateUpdate } = await capturePlannerPhase('en', 'phaseEvent');
		const result = normalize(buildStateUpdate, 'Plot prose.\n\n**Estimated length:** 7');
		expect(result.endsWith(`## ${ls(ESTIMATE_LABEL_KEY)}\n\n7`)).toBe(true);
	});

	it('guidance output is byte-identical to the input', async () => {
		const { buildStateUpdate } = await capturePlannerPhase('en', 'guidance');
		const input = 'Guidance prose.\n\n## Estimated length\n\n7';
		expect(normalize(buildStateUpdate, input)).toBe(input);
	});
});
