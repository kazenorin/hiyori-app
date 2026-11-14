import { describe, it, expect, vi, beforeEach } from 'vitest';

// Standard definitions-mock block (N5): parse/serialize act-summary fixtures need
// ls()-based headers/labels to render without loading locale strings.
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

// Unloaded locale strings make ls() emit missing-key warnings through log.warn
// (console output); silence them to keep test output pristine. Spread-override keeps
// setLogLevel real — the settings store calls it at module init.
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

import type { PipelineContext } from '#lib/ai/pipeline/types.ts';
import {
	generateSummarizerResult,
	generateFullSummary,
	type SummarizerInput,
	type SummarizerPrompts,
} from '#lib/ai/pipeline/summarizer.ts';
import { summarizerExtractionPromptTemplate } from '#lib/definitions/pipeline-prompts.ts';

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

beforeEach(() => {
	calls.length = 0;
});

describe('summarizer shared-prefix layout', () => {
	it('incremental: shared system + prefix + tail summary + role prompt + scene line', async () => {
		await generateSummarizerResult(input(), prompts);
		const { system, messages } = calls[0];
		expect(system).toBe('SHARED-SYSTEM GEN-INSTR');
		const contents = messages.map((m) => m.content);
		expect(contents[0]).toContain('WORLD-BODY');
		expect(contents.some((c) => c.includes('They arrive at the gate.'))).toBe(true);
		const tailStart = contents.findIndex((c) => c.includes('Scene 8: Before'));
		expect(tailStart).toBeGreaterThan(contents.findIndex((c) => c.includes('WORLD-BODY')));
		expect(contents[tailStart + 1]).toContain('INCREMENTAL-ROLE');
		expect(contents[tailStart + 2]).toBe(summarizerExtractionPromptTemplate('9', 'The Gate'));
		expect(contents.some((c) => c.includes('PLOT-BODY'))).toBe(true);
	});

	it('full fallback keeps the non-empty existing summary in the tail (F8)', async () => {
		await generateFullSummary(input(), prompts);
		const contents = calls[0].messages.map((m) => m.content);
		expect(contents.some((c) => c.includes('FULL-ROLE'))).toBe(true);
		expect(contents.some((c) => c.includes('Scene 8: Before'))).toBe(true);
	});

	it("first scene: empty-skeleton tail (today's parity), full role prompt present", async () => {
		await generateSummarizerResult(input({ actSummary: '' }), prompts);
		const contents = calls[0].messages.map((m) => m.content);
		const roleIdx = contents.findIndex((c) => c.includes('FULL-ROLE'));
		expect(roleIdx).toBeGreaterThan(0);
		expect(contents[roleIdx - 1]).toContain('Act Summary');
		expect(contents[roleIdx - 1]).toContain('Scene Summaries');
		expect(contents.some((c) => c.includes('Scene 8: Before'))).toBe(false);
	});

	it('transcript branch: bespoke system prompt, no shared prefix, no tools (F4)', async () => {
		// The transcript branch lives in generateFullSummary; the regen caller passes an
		// empty actSummary and no context (see regenerateActSummary in chat.svelte.ts).
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
});
