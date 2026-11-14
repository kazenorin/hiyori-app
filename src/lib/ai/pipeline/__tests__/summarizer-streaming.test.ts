import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#lib/definitions/common-headers.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	actSummaryHeader: () => 'Act Summary',
	turnOfEventsHeader: () => 'Turn Of Events',
	summaryHeader: () => 'Summary',
}));
vi.mock('#lib/definitions/common-labels.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	sceneWithNumberLabel: (n: number | string) => `Scene ${n}`,
	locationLabel: () => 'Location',
	aliasesLabel: () => 'Aliases',
	lastUpdateLabel: () => 'Last update',
}));
vi.mock('#lib/definitions/pipeline-prompts.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	sceneSummariesHeader: () => 'Scene Summaries',
	characterSummariesHeader: () => 'Character Summaries',
	characterProfilesHeader: () => 'Character Profiles',
	characterSummariesSinceSceneLabel: (n: number) => `Summaries of each character for recent Scenes since Scene ${n}.`,
}));
vi.mock('#lib/logging/logger.ts', () => ({
	log: { info: vi.fn(async () => {}), error: vi.fn(async () => {}), warn: vi.fn(async () => {}), debug: vi.fn(async () => {}) },
	fileLog: vi.fn(async () => {}),
}));

const VALID_SUMMARY = '# Act Summary\n\n## Scene Summaries\n\n### Scene 9: The Gate\n- Location: Gate\n- Summary: They arrive.';

// Scriptable streaming seam: each call shifts the next scripted response.
const streamResponses: string[] = [];
vi.mock('#lib/ai/chat-stream.ts', () => ({
	DEFAULT_RETRY_CONFIG: { retryCount: 2, backoffIntervalSeconds: 2 },
	streamWithRetry: vi.fn(
		async (
			_system: string,
			_messages: never[],
			options: { onProgress?: (s: { content: string; reasoning: string | null; variables: null }) => void }
		) => {
			const content = streamResponses.shift() ?? VALID_SUMMARY;
			const state = { content, reasoning: 'summary thoughts', variables: null };
			options.onProgress?.(state);
			return {
				state,
				resultMetadata: Promise.resolve({
					finishReason: 'stop',
					usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
					durationMs: 1,
					models: new Set(['m']),
				}),
				callbacks: {},
			};
		}
	),
}));
// The fallback uses the REAL aggregateMetadata from phase-executor; importOriginal
// loads it. Settings/provider/logger are mocked so the real module graph loads
// without browser/runtime dependencies.
vi.mock('#lib/stores/settings.svelte.ts', () => ({
	getSettings: () => ({}),
	isMemoryAvailable: () => false,
}));
vi.mock('#lib/ai/provider/provider.ts', () => ({ createModel: vi.fn() }));
vi.mock('#lib/ai/pipeline/phase-executor.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	runNonStreamingPhase: vi.fn(async () => ({
		text: VALID_SUMMARY,
		metadata: { finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, durationMs: 1, models: new Set(['m']) },
	})),
}));

// parseIncrementalOutput is spied so the fallback test can force a parse failure
// while every other test uses the real parser.
vi.mock('#lib/ai/act-summary-parser.ts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/ai/act-summary-parser.ts')>();
	return { ...actual, parseIncrementalOutput: vi.fn(actual.parseIncrementalOutput) };
});

import {
	generateSummarizerResult,
	generateFullSummary,
	type SummarizerInput,
	type SummarizerPrompts,
} from '#lib/ai/pipeline/summarizer.ts';
import { parseIncrementalOutput } from '#lib/ai/act-summary-parser.ts';
import type { PipelineContext } from '#lib/ai/pipeline/types.ts';
import type { PipelineCallbacks } from '#lib/ai/pipeline/types.ts';

const context: PipelineContext = {
	worldContent: '',
	actPlot: '',
	previousActSummaries: [],
	summarizationPoint: 0,
	characterProfiles: [],
	actSummaryAtSP: '',
	scenesSections: ['## Scene 9\n### Narrative Body\nThey arrive at the gate.'],
	plotMode: 'guidance',
};
const prompts: SummarizerPrompts = {
	summarizerPrompt: 'FULL-ROLE {{actSummaryTemplate}}',
	summarizerIncrementalPrompt: 'INCREMENTAL-ROLE {{actSummaryTemplate}}',
	characterProfileCompressorPrompt: 'COMPRESSOR-ROLE',
	mainChatSystemPrompt: 'SHARED-SYSTEM {{generalInstructions}}',
	generalInstructions: 'GEN-INSTR',
};
const existingSummary = '# Act Summary\n\n## Scene Summaries\n\n### Scene 8: Before\n- Location: Road\n- Summary: Earlier events.';

function makeCallbacks(): PipelineCallbacks {
	return {
		onPhaseStart: vi.fn(),
		onPhaseStream: vi.fn(),
		onPhaseRetry: vi.fn(),
		onPhaseComplete: vi.fn(),
		onError: vi.fn(),
		onAllComplete: vi.fn(),
	};
}

function input(callbacks?: PipelineCallbacks, overrides: Partial<SummarizerInput> = {}): SummarizerInput {
	return {
		actSummary: existingSummary,
		completedScenes: 9,
		previousNarrativeVariables: {
			sceneTitle: 'The Gate',
			background: null,
			narrativeBody: 'They arrive at the gate.',
			turnOfEvents: null,
			cg: null,
			gameData: null,
		},
		player: { playerResponse: 'Open the gate', playerMessageId: 'msg-9' },
		providerConfig: { id: 'p', provider: 'openai', apiType: 'chat', baseURL: '', model: 'm', apiKey: 'k' } as never,
		abortSignal: new AbortController().signal,
		context,
		tools: undefined,
		callbacks,
		...overrides,
	};
}

beforeEach(() => {
	streamResponses.length = 0;
	vi.clearAllMocks();
});

describe('summarizer streaming lifecycle', () => {
	it('fires start → stream → complete with the MERGED summary and metadata', async () => {
		// WHY: the pane must end on the same merged summary that is persisted,
		// and the meta line needs the phase's token stats at completion.
		const callbacks = makeCallbacks();
		const result = await generateSummarizerResult(input(callbacks), prompts);

		expect(callbacks.onPhaseStart).toHaveBeenCalledTimes(1);
		expect(callbacks.onPhaseStart).toHaveBeenCalledWith('SUMMARIZER');
		expect(callbacks.onPhaseStream).toHaveBeenCalled();
		expect(callbacks.onPhaseComplete).toHaveBeenCalledTimes(1);
		const [phase, state, metadata] = vi.mocked(callbacks.onPhaseComplete).mock.calls[0];
		expect(phase).toBe('SUMMARIZER');
		expect(state.actSummary).toBe(result.serializedSummary);
		expect(result.serializedSummary).toContain('Scene 8: Before');
		expect(result.serializedSummary).toContain('Scene 9: The Gate');
		expect(metadata?.usage.inputTokens).toBe(10);
	});

	it('fallback re-streams under ONE chip and aggregates metadata from both calls', async () => {
		// WHY: incremental→full is two LLM calls but one phase; the user must not
		// see a second chip, and token stats must cover both calls.
		vi.mocked(parseIncrementalOutput).mockImplementationOnce(() => {
			throw new Error('format drift');
		});
		streamResponses.push('ignored incremental output', VALID_SUMMARY);
		const callbacks = makeCallbacks();
		const result = await generateSummarizerResult(input(callbacks), prompts);

		expect(callbacks.onPhaseStart).toHaveBeenCalledTimes(1);
		expect(callbacks.onPhaseComplete).toHaveBeenCalledTimes(1);
		const metadata = vi.mocked(callbacks.onPhaseComplete).mock.calls[0][2];
		expect(metadata?.usage.inputTokens).toBe(20);
		expect(metadata?.usage.totalTokens).toBe(30);
		expect(result.serializedSummary).toContain('Scene 9: The Gate');
	});

	it('without callbacks (transcript backfill) fires no lifecycle and uses generateText', async () => {
		const { runNonStreamingPhase } = await import('#lib/ai/pipeline/phase-executor.ts');
		const result = await generateFullSummary(
			input(undefined, { transcript: [{ role: 'user', content: 'hello' }], context: undefined, actSummary: '' }),
			prompts
		);
		expect(runNonStreamingPhase).toHaveBeenCalledTimes(1);
		expect(result.serializedSummary).toContain('Scene 9');
	});

	it('stream errors propagate to the caller (chain-level handling)', async () => {
		const { streamWithRetry } = await import('#lib/ai/chat-stream.ts');
		vi.mocked(streamWithRetry).mockRejectedValueOnce(new Error('provider down'));
		const callbacks = makeCallbacks();
		await expect(generateSummarizerResult(input(callbacks), prompts)).rejects.toThrow('provider down');
		expect(callbacks.onPhaseComplete).not.toHaveBeenCalled();
	});
});
