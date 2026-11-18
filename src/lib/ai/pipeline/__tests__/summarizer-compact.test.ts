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
vi.mock('#lib/definitions/character-profile-labels.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	stateLabel: () => 'State',
	loglineLabel: () => 'Logline',
	goalLabel: () => 'Goal',
	relationshipsLabel: () => 'Relationships',
	voiceLabel: () => 'Voice',
	traitsLabel: () => 'Traits',
	importanceLabel: () => 'Importance',
}));
vi.mock('#lib/logging/logger.ts', async (importOriginal) => ({
	...(await importOriginal<object>()),
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {}),
	},
	fileLog: vi.fn(async () => {}),
}));

const mockSettings = vi.hoisted(() => ({ backgroundContextMode: 'compact' as 'rich' | 'compact' }));
vi.mock('#lib/stores/settings.svelte.ts', () => ({
	getSettings: () => mockSettings,
	isMemoryAvailable: () => false,
}));

const calls: { system: string; messages: { role: string; content: string }[]; tools: unknown }[] = [];
vi.mock('#lib/ai/pipeline/phase-executor.ts', () => ({
	runNonStreamingPhase: vi.fn(
		async (phase: string, system: string, messages: never[], config: unknown, signal: unknown, tools: unknown) => {
			calls.push({ system, messages, tools });
			return {
				text: '## Scene Summaries\n\n### Scene 9: The Gate\n- Location: Gate\n- Summary: They arrive.',
				metadata: {
					finishReason: 'stop',
					usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
					durationMs: 1,
					models: new Set(['m']),
				},
			};
		}
	),
}));

const streamCalls: { system: string; messages: { role: string; content: string }[]; tools: unknown }[] = [];
vi.mock('#lib/ai/chat-stream.ts', () => ({
	DEFAULT_RETRY_CONFIG: { retryCount: 2, backoffIntervalSeconds: 2 },
	streamWithRetry: vi.fn(
		async (
			system: string,
			messages: { role: string; content: string }[],
			options: { tools?: unknown; onProgress?: (s: { content: string; reasoning: null; variables: null }) => void }
		) => {
			streamCalls.push({ system, messages, tools: options.tools });
			const state = {
				content: '## Scene Summaries\n\n### Scene 9: The Gate\n- Location: Gate\n- Summary: They arrive.',
				reasoning: null,
				variables: null,
			};
			options.onProgress?.(state);
			return {
				state,
				resultMetadata: Promise.resolve({
					finishReason: 'stop',
					usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
					durationMs: 1,
					models: new Set(['m']),
				}),
				callbacks: {},
			};
		}
	),
}));

import type { PipelineContext } from '#lib/ai/pipeline/types.ts';
import {
	generateSummarizerResult,
	generateFullSummary,
	type SummarizerInput,
	type SummarizerPrompts,
} from '#lib/ai/pipeline/summarizer.ts';
import { summarizerExtractionPromptTemplate, summarizerFallbackExtractionPromptTemplate } from '#lib/definitions/pipeline-prompts.ts';
import { loadLocaleStrings } from '#lib/localization/index.ts';

const context: PipelineContext = {
	worldContent: 'WORLD-BODY',
	actPlot: 'PLOT-BODY',
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

function input(overrides: Partial<SummarizerInput> = {}): SummarizerInput {
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
		...overrides,
	};
}

beforeEach(async () => {
	calls.length = 0;
	streamCalls.length = 0;
	mockSettings.backgroundContextMode = 'compact';
	await loadLocaleStrings('en');
});

describe('summarizer compact layout', () => {
	it('incremental: role prompt as system, lean sections, no tools, no shared prefix', async () => {
		await generateSummarizerResult(input(), prompts);
		const { system, messages, tools } = streamCalls[0];
		expect(system).toContain('INCREMENTAL-ROLE');
		expect(tools).toBeUndefined();
		const contents = messages.map((m) => m.content);
		expect(contents.some((c) => c.includes('WORLD-BODY'))).toBe(false);
		expect(contents.some((c) => c.includes('INCREMENTAL-ROLE'))).toBe(false);
		expect(contents[0]).toContain('Scene 8: Before');
		expect(contents[1]).toContain('Narrative Body for Scene 9');
		expect(contents[1]).toContain('They arrive at the gate.');
		expect(contents[2]).toContain('Open the gate');
		expect(contents[3]).toBe(summarizerExtractionPromptTemplate('9', 'The Gate'));
		expect(contents).toHaveLength(4);
	});

	it('full: role prompt as system only, no role prompt in the tail', async () => {
		await generateFullSummary(input({ actSummary: '' }), prompts);
		const { system, messages, tools } = streamCalls[0];
		expect(system).toContain('FULL-ROLE');
		expect(tools).toBeUndefined();
		const contents = messages.map((m) => m.content);
		expect(contents.some((c) => c.includes('FULL-ROLE'))).toBe(false);
		// Empty act summary still serializes to a header skeleton (today's parity).
		expect(contents).toHaveLength(4);
		expect(contents[0]).toContain('Act Summary');
		expect(contents[1]).toContain('They arrive at the gate.');
		expect(contents[2]).toContain('Open the gate');
		expect(contents[3]).toBe(summarizerExtractionPromptTemplate('9', 'The Gate'));
	});

	it('fallback (no narrative body): summary + player response + fallback line', async () => {
		await generateFullSummary(input({ previousNarrativeVariables: undefined }), prompts);
		const contents = streamCalls[0].messages.map((m) => m.content);
		expect(contents).toHaveLength(3);
		expect(contents[0]).toContain('Scene 8: Before');
		expect(contents[1]).toContain('Open the gate');
		expect(contents[2]).toBe(summarizerFallbackExtractionPromptTemplate(9));
	});

	it('transcript branch stays bespoke under compact settings', async () => {
		await generateFullSummary(
			input({
				transcript: [
					{ role: 'user', content: 'hello' },
					{ role: 'assistant', content: 'story text' },
				],
				context: undefined,
				actSummary: '',
			}),
			prompts
		);
		const { system, messages, tools } = calls[0];
		expect(system).toContain('FULL-ROLE');
		expect(messages.map((m) => m.content).some((c) => c.includes('WORLD-BODY'))).toBe(false);
		expect(tools).toBeUndefined();
	});

	it('mode switch: rich settings restore the shared system + prefix', async () => {
		mockSettings.backgroundContextMode = 'rich';
		await generateSummarizerResult(input(), prompts);
		const { system, messages } = streamCalls[0];
		expect(system).toBe('SHARED-SYSTEM GEN-INSTR');
		expect(messages.map((m) => m.content)[0]).toContain('WORLD-BODY');
	});
});
