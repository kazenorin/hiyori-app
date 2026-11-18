import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#lib/logging/logger.ts', () => ({
	log: { info: vi.fn(async () => {}), error: vi.fn(async () => {}), warn: vi.fn(async () => {}), debug: vi.fn(async () => {}) },
	fileLog: vi.fn(async () => {}),
}));

import { createTestDatabase } from '../../../__tests__/helpers/test-database';
import { runMigrations } from '#lib/db/migrations.ts';

let testDb: ReturnType<typeof createTestDatabase>;
vi.mock('#lib/db/database.ts', () => ({
	initDatabase: vi.fn(async () => testDb),
	getDatabase: vi.fn(() => testDb),
}));

const mockSettings = vi.hoisted(() => ({
	characterProfileCompressorInterval: 5,
	backgroundContextMode: 'rich' as 'rich' | 'compact',
	characterProfileUpdateMethod: 'structuredMarkdown' as 'structuredMarkdown' | 'toolCalls',
}));
vi.mock('#lib/stores/settings.svelte.ts', () => ({
	getSettings: () => mockSettings,
	isMemoryAvailable: () => false,
}));

const dbFlags = vi.hoisted(() => ({ checkpointError: false, lookupError: false, baselineError: false, writeError: false }));
vi.mock('#lib/db/act-lines.ts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/db/act-lines.ts')>();
	return {
		...actual,
		recordCharacterProfileCompression: async (...args: Parameters<typeof actual.recordCharacterProfileCompression>) => {
			if (dbFlags.checkpointError) throw new Error('checkpoint unavailable');
			return actual.recordCharacterProfileCompression(...args);
		},
	};
});
vi.mock('#lib/db/character-profiles.ts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/db/character-profiles.ts')>();
	return {
		...actual,
		getLatestProfilesByActLine: async (...args: Parameters<typeof actual.getLatestProfilesByActLine>) => {
			if (dbFlags.baselineError) throw new Error('baseline unavailable');
			return actual.getLatestProfilesByActLine(...args);
		},
		getLatestProfileByAlias: async (...args: Parameters<typeof actual.getLatestProfileByAlias>) => {
			if (dbFlags.lookupError) throw new Error('profile lookup unavailable');
			return actual.getLatestProfileByAlias(...args);
		},
		insertCharacterProfile: async (...args: Parameters<typeof actual.insertCharacterProfile>) => {
			if (dbFlags.writeError) throw new Error('profile write unavailable');
			return actual.insertCharacterProfile(...args);
		},
	};
});

interface QueuedStream {
	text?: string;
	metadata?: Record<string, unknown>;
	error?: Error;
	toolCalls?: Record<string, unknown>[];
	reasoning?: string;
	onCall?: () => Promise<void> | void;
	retry?: { attempt: number; maxAttempts: number };
}

interface StreamCall {
	system: string;
	messages: { role: string; content: string }[];
	tools: Record<string, unknown> | undefined;
	providerConfig: { model: string };
}

let queue: QueuedStream[] = [];
let streamCalls: StreamCall[] = [];

vi.mock('#lib/ai/chat-stream.ts', () => ({
	DEFAULT_RETRY_CONFIG: { retryCount: 2, backoffIntervalSeconds: 2 },
	streamWithRetry: vi.fn(
		async (
			system: string,
			messages: { role: string; content: string }[],
			options: {
				tools?: Record<string, { execute: (input: never, context: never) => Promise<string> }>;
				providerConfig: { model: string };
				onProgress?: (state: { content: string; reasoning: string | null; variables: null }) => void;
				onRetry?: (attempt: number, maxAttempts: number) => void;
			}
		) => {
			const item = queue.shift();
			if (!item) throw new Error('unexpected stream request');
			streamCalls.push({ system, messages, tools: options.tools, providerConfig: options.providerConfig });
			options.onProgress?.({ content: item.text ?? '', reasoning: item.reasoning ?? null, variables: null });
			await item.onCall?.();
			if (item.error) throw item.error;
			for (const call of item.toolCalls ?? []) {
				await options.tools!['update-character-profile'].execute(call as never, {} as never);
			}
			if (item.retry) options.onRetry?.(item.retry.attempt, item.retry.maxAttempts);
			return {
				state: { content: item.text ?? '', reasoning: item.reasoning ?? null, variables: null },
				resultMetadata: Promise.resolve(
					item.metadata ?? {
						finishReason: 'stop',
						usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
						durationMs: 1,
						models: new Set(['provider-model']),
					}
				),
				callbacks: {},
			};
		}
	),
}));

import { generateCharacterProfiles } from '#lib/ai/pipeline/summarizer.ts';
import type { ProfileCompressionState, PipelineContext, PipelineCallbacks } from '#lib/ai/pipeline/types.ts';
import { insertCharacterProfile, getLatestProfileByAlias } from '#lib/db/character-profiles.ts';
import { getLastCompressionScene, recordCharacterProfileCompression } from '#lib/db/act-lines.ts';
import { parseActSummary } from '#lib/ai/act-summary-parser.ts';
import { loadLocaleStrings } from '#lib/localization/index.ts';
import { loadLocale, t } from '#lib/i18n/index.ts';
import {
	getProfileUpdateLabels,
	profileUpdateContract,
	profileUpdateRepairInstructions,
	templateFitterSystemPrompt,
} from '#lib/definitions/pipeline-prompts.ts';
import { buildUpdateCharacterProfileTools } from '#lib/ai/tools/update-character-profile.ts';

const LINE = 'line-1';
const SUMMARIZER = { model: 'summarizer-m' } as never;
const FITTER = { model: 'fitter-m' } as never;

const context: PipelineContext = {
	worldContent: '',
	actPlot: '',
	previousActSummaries: [],
	summarizationPoint: 0,
	characterProfiles: [],
	actSummaryAtSP: '',
	scenesSections: [],
	plotMode: 'guidance',
};
const prompts = {
	summarizerPrompt: '',
	summarizerIncrementalPrompt: '',
	characterProfileCompressorPrompt: 'COMPRESSOR-ROLE',
	mainChatSystemPrompt: 'SHARED {{generalInstructions}}',
	generalInstructions: 'GI',
};
const newSummary = parseActSummary(
	'# Act Summary\n\n## Scene Summaries\n\n### Scene 9: The Gate\n- Location: Gate\n- Summary: They arrive.'
);

function state(): ProfileCompressionState {
	return { completedScenes: 9, newActSummary: undefined, attemptCount: 0, successCount: 0 };
}

function makeCallbacks(): PipelineCallbacks {
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

function input(compression: ProfileCompressionState, callbacks?: PipelineCallbacks, abortSignal = new AbortController().signal) {
	return {
		actLineId: LINE,
		completedScenes: 9,
		assistant: { messageId: 'msg-10', messageSequence: 10 },
		providerConfig: SUMMARIZER,
		minorTaskAgentProviderConfig: FITTER,
		abortSignal,
		context,
		tools: undefined,
		compression,
		callbacks,
	};
}

function markdown(records: { name: string; fields?: Record<string, string | string[]> }[]): string {
	const l = getProfileUpdateLabels();
	const lines = [`# ${l.envelope}`, `- ${l.count}: ${records.length}`];
	for (const record of records) {
		lines.push('', `## ${record.name}`);
		for (const [field, value] of Object.entries(record.fields ?? {})) {
			const label = l.fields[field as keyof typeof l.fields];
			if (Array.isArray(value)) {
				lines.push(`### ${label}`, ...value.map((item) => `- ${item}`));
			} else {
				lines.push(`- ${label}: ${value}`);
			}
		}
	}
	return lines.join('\n');
}

async function snapshotCount(sceneNumber: number): Promise<number> {
	const rows = await testDb.select<{ c: number }[]>(
		'SELECT COUNT(*) AS c FROM character_profiles WHERE act_line_id = $1 AND scene_number = $2',
		[LINE, sceneNumber]
	);
	return rows[0]!.c;
}

function meta(overrides: Record<string, unknown> = {}) {
	return {
		finishReason: 'stop',
		usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
		durationMs: 1,
		models: new Set(['provider-model']),
		...overrides,
	};
}

function withTools(compression: ProfileCompressionState, callbacks?: PipelineCallbacks) {
	return {
		...input(compression, callbacks),
		tools: buildUpdateCharacterProfileTools({ story: { id: 's' }, actLine: { id: LINE }, act: { id: 'a' } } as never, compression),
	};
}

beforeEach(async () => {
	testDb = createTestDatabase();
	await runMigrations();
	await loadLocaleStrings('en');
	await loadLocale('en');
	queue = [];
	streamCalls = [];
	dbFlags.checkpointError = false;
	dbFlags.lookupError = false;
	dbFlags.baselineError = false;
	dbFlags.writeError = false;
	mockSettings.characterProfileCompressorInterval = 5;
	mockSettings.backgroundContextMode = 'rich';
	mockSettings.characterProfileUpdateMethod = 'structuredMarkdown';
	await insertCharacterProfile({
		id: 'p1',
		actLineId: LINE,
		sceneNumber: 4,
		canonicalName: 'elena-vale',
		preferredName: 'Elena Vale',
		aliases: ['Elena Vale'],
		logline: 'A wary scout',
		state: 'Wounded',
		goal: null,
		relationships: null,
		voice: null,
		traits: [],
		sceneDetails: '',
		importance: 2,
	});
});

describe('compressor structured Markdown route', () => {
	it('applies one valid Markdown batch with no tools and no fitter request', async () => {
		// WHY: the default transport validates a completed text batch and applies it
		// directly; a valid batch must never pay for repair or the tool loop.
		queue.push({ text: markdown([{ name: 'Elena Vale', fields: { state: 'Recovered' } }]) });
		const compression = state();
		const callbacks = makeCallbacks();

		const result = await generateCharacterProfiles(newSummary, input(compression, callbacks), prompts);

		expect(result).not.toBeNull();
		expect(streamCalls).toHaveLength(1);
		expect(streamCalls[0]!.tools).toBeUndefined();
		expect(streamCalls[0]!.providerConfig).toBe(SUMMARIZER);
		const markdownContract = profileUpdateContract('structuredMarkdown', getProfileUpdateLabels());
		expect(streamCalls[0]!.system).toBe('SHARED GI');
		expect(streamCalls[0]!.messages.at(-1)!.content).toContain(markdownContract);
		expect(streamCalls[0]!.messages.at(-1)!.content.split(markdownContract)).toHaveLength(2);
		expect(await snapshotCount(9)).toBe(1);
		const latest = await getLatestProfileByAlias(LINE, 'Elena Vale');
		expect(latest).toMatchObject({ state: 'Recovered', sceneNumber: 9 });
		expect(await getLastCompressionScene(LINE)).toBe(9);
	});

	it('records a valid zero-count batch as a no-op without applying or repairing', async () => {
		const l = getProfileUpdateLabels();
		queue.push({ text: `# ${l.envelope}\n- ${l.count}: 0` });
		const compression = state();
		const result = await generateCharacterProfiles(newSummary, input(compression), prompts);

		expect(result).not.toBeNull();
		expect(streamCalls).toHaveLength(1);
		expect(await snapshotCount(9)).toBe(0);
		expect(compression.attemptCount).toBe(0);
		expect(await getLastCompressionScene(LINE)).toBe(9);
	});
});

describe('structured Markdown repair and fallback bounds', () => {
	it('repairs an invalid completed batch once with the fitter and no tools or story context', async () => {
		queue.push({ text: 'not a batch at all' });
		queue.push({ text: markdown([{ name: 'Elena Vale', fields: { state: 'Healed' } }]) });
		const compression = state();
		const callbacks = makeCallbacks();
		const result = await generateCharacterProfiles(
			newSummary,
			{ ...input(compression, callbacks), context: { ...context, worldContent: 'WORLD-BODY' } },
			prompts
		);

		expect(streamCalls).toHaveLength(2);
		const [generation, repair] = streamCalls;
		expect(compression.attemptCount).toBe(1); // parsing/repair are not profile attempts
		expect(generation!.tools).toBeUndefined();
		expect(repair!.tools).toBeUndefined();
		expect(repair!.providerConfig).toBe(FITTER);
		expect(repair!.system).toBe(templateFitterSystemPrompt());

		// The fitter reformats only: it receives the captured contract, errors,
		// the raw candidate and preservation instructions as data.
		const labels = getProfileUpdateLabels();
		const contract = profileUpdateContract('structuredMarkdown', labels);
		const instructions = profileUpdateRepairInstructions(labels);
		const repairContent = repair!.messages.map((message) => message.content).join('\n');
		expect(repairContent).toContain(contract);
		expect(repairContent).toContain(instructions);
		// Preservation of omissions/clears and the no-fabrication/no-drop rules live in
		// the production repair instructions, which must reach the fitter verbatim.
		expect(instructions).toContain(labels.clearFields);
		expect(instructions).toContain(labels.fields.traits);
		expect(repairContent).toContain('not a batch at all');
		expect(repairContent.split('\n').some((line) => line.startsWith('- '))).toBe(true);
		expect(repairContent).not.toContain('WORLD-BODY');

		const latest = await getLatestProfileByAlias(LINE, 'Elena Vale');
		expect(latest).toMatchObject({ state: 'Healed', sceneNumber: 9 });
		expect(result?.metadata.usage.inputTokens).toBe(2);
		expect([...(result?.metadata.models ?? [])].sort()).toEqual(['fitter-m', 'provider-model', 'summarizer-m']);
	});

	it('validates the repaired batch independently instead of combining original records', async () => {
		const invalidOriginal = `${markdown([{ name: 'Elena Vale', fields: { state: 'Corrupted' } }])}\n\nExtra prose.`;
		queue.push({ text: invalidOriginal });
		queue.push({ text: markdown([{ name: 'New Ally', fields: { logline: 'A newcomer' } }]) });

		await generateCharacterProfiles(newSummary, input(state()), prompts);

		expect(streamCalls).toHaveLength(2);
		const elena = await getLatestProfileByAlias(LINE, 'Elena Vale');
		expect(elena).toMatchObject({ sceneNumber: 4, state: 'Wounded' });
		const ally = await getLatestProfileByAlias(LINE, 'New Ally');
		expect(ally?.sceneNumber).toBe(9);
		expect(await snapshotCount(9)).toBe(1);
	});

	it('falls back to tools once when the repaired batch is invalid, writing nothing first', async () => {
		queue.push({ text: 'garbage' });
		queue.push({
			text: 'still garbage',
			onCall: async () => {
				expect(await snapshotCount(9)).toBe(0);
			},
		});
		queue.push({ toolCalls: [{ name: 'Elena Vale', state: 'ToolHealed' }] });

		const compression = state();
		const result = await generateCharacterProfiles(newSummary, withTools(compression), prompts);

		expect(result).not.toBeNull();
		expect(streamCalls).toHaveLength(3);
		expect(streamCalls[2]!.tools).toBeDefined();
		expect(streamCalls[2]!.providerConfig).toBe(SUMMARIZER);
		expect((await getLatestProfileByAlias(LINE, 'Elena Vale'))?.state).toBe('ToolHealed');
		expect(mockSettings.characterProfileUpdateMethod).toBe('structuredMarkdown');
	});

	it('skips repair when no fitter provider is configured', async () => {
		queue.push({ text: 'garbage' });
		queue.push({ toolCalls: [{ name: 'Elena Vale', state: 'NoFitter' }] });

		await generateCharacterProfiles(newSummary, { ...withTools(state()), minorTaskAgentProviderConfig: undefined }, prompts);

		expect(streamCalls).toHaveLength(2);
		expect(streamCalls[1]!.providerConfig).toBe(SUMMARIZER);
		expect(streamCalls[1]!.tools).toBeDefined();
		expect((await getLatestProfileByAlias(LINE, 'Elena Vale'))?.state).toBe('NoFitter');
	});

	it('skips repair when generation failed and uses tools once', async () => {
		// A failed stream may have emitted partial text; it must not be repaired or applied.
		queue.push({
			text: markdown([{ name: 'Elena Vale', fields: { state: 'Partial' } }]),
			error: new Error('provider down'),
		});
		queue.push({ toolCalls: [{ name: 'Elena Vale', state: 'AfterFailure' }] });

		await generateCharacterProfiles(newSummary, withTools(state()), prompts);

		expect(streamCalls).toHaveLength(2);
		expect(streamCalls[1]!.providerConfig).toBe(SUMMARIZER);
		expect(streamCalls[1]!.tools).toBeDefined();
		expect((await getLatestProfileByAlias(LINE, 'Elena Vale'))?.state).toBe('AfterFailure');
	});

	it('skips repair for a blank completed generation and records why in the committed log', async () => {
		queue.push({ text: '   ' });
		queue.push({ toolCalls: [{ name: 'Elena Vale', state: 'AfterBlank' }] });

		const compression = state();
		const callbacks = makeCallbacks();
		await generateCharacterProfiles(newSummary, withTools(compression, callbacks), prompts);

		expect(streamCalls).toHaveLength(2);
		expect(streamCalls[1]!.providerConfig).toBe(SUMMARIZER);
		expect((await getLatestProfileByAlias(LINE, 'Elena Vale'))?.state).toBe('AfterBlank');
		const terminalLog = vi.mocked(callbacks.onPhaseComplete).mock.calls[0][1].profileCompressionLog!;
		expect(terminalLog).toContain('## Tool fallback');
		expect(terminalLog).not.toContain('## Tools');
		expect(terminalLog).toContain(t('pipeline.compressorStages.blankBody'));
		expect(terminalLog).not.toContain('Preview (uncommitted)');
	});

	it('rejects a truncated known finish reason and repairs the body', async () => {
		queue.push({
			text: markdown([{ name: 'Elena Vale', fields: { state: 'Draft' } }]),
			metadata: meta({ finishReason: 'length' }),
		});
		queue.push({ text: markdown([{ name: 'Elena Vale', fields: { state: 'Final' } }]) });

		await generateCharacterProfiles(newSummary, input(state()), prompts);

		expect(streamCalls).toHaveLength(2);
		expect(streamCalls[1]!.system).toBe(templateFitterSystemPrompt());
		expect((await getLatestProfileByAlias(LINE, 'Elena Vale'))?.state).toBe('Final');
	});

	it('lets an unknown finish reason pass structural validation', async () => {
		queue.push({
			text: markdown([{ name: 'Elena Vale', fields: { state: 'Unsure' } }]),
			metadata: meta({ finishReason: 'unknown' }),
		});

		await generateCharacterProfiles(newSummary, input(state()), prompts);

		expect(streamCalls).toHaveLength(1);
		expect((await getLatestProfileByAlias(LINE, 'Elena Vale'))?.state).toBe('Unsure');
	});

	it('reloads the baseline before the tool fallback', async () => {
		queue.push({
			text: 'garbage',
			onCall: async () => {
				await insertCharacterProfile({
					id: 'p-new',
					actLineId: LINE,
					sceneNumber: 5,
					canonicalName: 'newcomer',
					preferredName: 'Newcomer',
					aliases: ['Newcomer'],
					logline: '',
					state: null,
					goal: null,
					relationships: null,
					voice: null,
					traits: [],
					sceneDetails: '',
					importance: 3,
				});
			},
		});
		queue.push({ text: 'still garbage' });
		queue.push({ toolCalls: [{ name: 'Newcomer', state: 'Arrived' }] });

		await generateCharacterProfiles(newSummary, withTools(state()), prompts);

		expect(streamCalls).toHaveLength(3);
		expect(streamCalls[0]!.messages.some((message) => message.content.includes('Newcomer'))).toBe(false);
		expect(streamCalls[2]!.messages.some((message) => message.content.includes('Newcomer'))).toBe(true);
		expect((await getLatestProfileByAlias(LINE, 'Newcomer'))?.state).toBe('Arrived');
	});
});

describe('direct tool mode and layouts', () => {
	it('direct toolCalls mode runs the tool workflow and appends only its contract', async () => {
		mockSettings.characterProfileUpdateMethod = 'toolCalls';
		queue.push({ toolCalls: [{ name: 'Elena Vale', state: 'ToolMode' }] });
		const compression = state();

		const result = await generateCharacterProfiles(newSummary, withTools(compression), prompts);

		expect(result).not.toBeNull();
		expect(streamCalls).toHaveLength(1);
		expect(streamCalls[0]!.tools).toBeDefined();
		expect(streamCalls[0]!.system).toBe('SHARED GI');
		const labels = getProfileUpdateLabels();
		const toolContract = profileUpdateContract('toolCalls', labels);
		const markdownContract = profileUpdateContract('structuredMarkdown', labels);
		const last = streamCalls[0]!.messages.at(-1)!.content;
		expect(last).toContain('COMPRESSOR-ROLE');
		expect(last).toContain(toolContract);
		expect(last.split(toolContract)).toHaveLength(2);
		expect(last).not.toContain(markdownContract);
		expect((await getLatestProfileByAlias(LINE, 'Elena Vale'))?.state).toBe('ToolMode');
		expect(await getLastCompressionScene(LINE)).toBe(9);
	});

	it('structured compact layout carries the contract in the system prompt', async () => {
		mockSettings.backgroundContextMode = 'compact';
		queue.push({ text: markdown([{ name: 'Elena Vale', fields: { state: 'CompactState' } }]) });

		await generateCharacterProfiles(newSummary, input(state()), prompts);

		expect(streamCalls).toHaveLength(1);
		const call = streamCalls[0]!;
		expect(call.system).toContain('COMPRESSOR-ROLE');
		const contract = profileUpdateContract('structuredMarkdown', getProfileUpdateLabels());
		expect(call.system).toContain(contract);
		expect(call.system.split(contract)).toHaveLength(2);
		expect(call.messages).toHaveLength(2);
		expect(call.tools).toBeUndefined();
		expect((await getLatestProfileByAlias(LINE, 'Elena Vale'))?.state).toBe('CompactState');
	});

	it('toolCalls compact layout carries the tool contract in the system prompt', async () => {
		mockSettings.backgroundContextMode = 'compact';
		mockSettings.characterProfileUpdateMethod = 'toolCalls';
		queue.push({ toolCalls: [{ name: 'Elena Vale', state: 'CompactTool' }] });

		await generateCharacterProfiles(newSummary, withTools(state()), prompts);

		const call = streamCalls[0]!;
		expect(call.system).toContain('COMPRESSOR-ROLE');
		const contract = profileUpdateContract('toolCalls', getProfileUpdateLabels());
		expect(call.system).toContain(contract);
		expect(call.system.split(contract)).toHaveLength(2);
		expect(call.messages).toHaveLength(2);
		expect(call.tools).toBeDefined();
		expect((await getLatestProfileByAlias(LINE, 'Elena Vale'))?.state).toBe('CompactTool');
	});
});

describe('gating, capture and cancellation', () => {
	it('interval 0 disables without a request', async () => {
		mockSettings.characterProfileCompressorInterval = 0;
		const result = await generateCharacterProfiles(newSummary, input(state()), prompts);
		expect(result).toBeNull();
		expect(streamCalls).toHaveLength(0);
	});

	it('an interface gate that is not due skips without a request', async () => {
		await recordCharacterProfileCompression(LINE, { messageId: 'msg-8', messageSequence: 8 }, 8);
		const result = await generateCharacterProfiles(newSummary, input(state()), prompts);
		expect(result).toBeNull();
		expect(streamCalls).toHaveLength(0);
	});

	it('captured method and labels survive mid-request setting and locale changes', async () => {
		const capturedContract = profileUpdateContract('structuredMarkdown', getProfileUpdateLabels());
		const capturedInstructions = profileUpdateRepairInstructions(getProfileUpdateLabels());
		const repairedText = markdown([{ name: 'Elena Vale', fields: { state: 'Captured' } }]);

		queue.push({
			text: 'garbage',
			onCall: async () => {
				mockSettings.characterProfileUpdateMethod = 'toolCalls';
				mockSettings.backgroundContextMode = 'compact';
				await loadLocaleStrings('zh-Hant-HK');
			},
		});
		queue.push({ text: repairedText });

		await generateCharacterProfiles(newSummary, input(state()), prompts);

		expect(streamCalls).toHaveLength(2);
		const repairContent = streamCalls[1]!.messages.map((message) => message.content).join('\n');
		expect(repairContent).toContain(capturedContract);
		expect(repairContent).toContain(capturedInstructions);
		expect((await getLatestProfileByAlias(LINE, 'Elena Vale'))?.state).toBe('Captured');
	});

	it('generation cancellation escapes without tools or writes', async () => {
		const controller = new AbortController();
		queue.push({
			error: new DOMException('Aborted', 'AbortError'),
			onCall: () => controller.abort(),
		});

		await expect(generateCharacterProfiles(newSummary, input(state(), undefined, controller.signal), prompts)).rejects.toThrow();
		expect(streamCalls).toHaveLength(1);
		expect(await snapshotCount(9)).toBe(0);
		expect(await getLastCompressionScene(LINE)).toBeNull();
	});

	it('cancellation between applied records stops later writes', async () => {
		const controller = new AbortController();
		const compression = state();
		const callbacks = makeCallbacks();
		callbacks.onPhaseStream = vi.fn((_phase, streamState) => {
			if (streamState.content.includes('### Elena Vale') && !controller.signal.aborted) controller.abort();
		});
		queue.push({
			text: markdown([
				{ name: 'Elena Vale', fields: { state: 'First' } },
				{ name: 'Amiri Verspera', fields: { state: 'Second' } },
			]),
		});

		await expect(generateCharacterProfiles(newSummary, input(compression, callbacks, controller.signal), prompts)).rejects.toThrow();

		expect(streamCalls).toHaveLength(1);
		expect(await snapshotCount(9)).toBe(1);
		expect((await getLatestProfileByAlias(LINE, 'Elena Vale'))?.state).toBe('First');
		expect(await getLatestProfileByAlias(LINE, 'Amiri Verspera')).toBeNull();
		expect(await getLastCompressionScene(LINE)).toBeNull();
		expect(vi.mocked(callbacks.onPhaseComplete)).not.toHaveBeenCalled();
		expect(vi.mocked(callbacks.onPhaseFailed)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(callbacks.onPhaseFailed!).mock.calls[0][1]?.profileCompressionLog).toContain('### Elena Vale');
		expect(compression.onAttempt).toBeUndefined();
	});
});

describe('compressor terminal lifecycle', () => {
	it('streams an uncommitted raw preview and commits stages plus applied attempts only', async () => {
		// WHY: raw model output may be invalid; it can guide the user live but must
		// never become the persisted terminal log.
		const l = getProfileUpdateLabels();
		const raw = markdown([{ name: 'Elena Vale', fields: { state: 'Previewed' } }]);
		queue.push({ text: raw, reasoning: 'raw thoughts' });
		const callbacks = makeCallbacks();
		const compression = state();

		await generateCharacterProfiles(newSummary, input(compression, callbacks), prompts);

		const streamed = vi.mocked(callbacks.onPhaseStream).mock.calls.map((call) => call[1]);
		expect(streamed.some((s) => s.content.includes('## Preview (uncommitted)') && s.content.includes(l.envelope))).toBe(true);
		expect(streamed.some((s) => s.reasoning === 'raw thoughts')).toBe(true);

		const terminalLog = vi.mocked(callbacks.onPhaseComplete).mock.calls[0][1].profileCompressionLog!;
		expect(terminalLog).toContain('## Generation');
		expect(terminalLog).toContain('## Applied updates');
		expect(terminalLog).toContain('### Elena Vale');
		expect(terminalLog).not.toContain('Preview (uncommitted)');
		expect(terminalLog).not.toContain(l.envelope);
		expect(vi.mocked(callbacks.onPhaseStart).mock.calls.map((c) => c[0])).toEqual(['CHARACTER_PROFILE_COMPRESSOR']);
		expect(compression.onAttempt).toBeUndefined();
	});

	it('labels direct tool calling with the neutral tools stage', async () => {
		// WHY: tool calling is the selected primary method here, so calling it a
		// fallback misstates why the stage ran.
		mockSettings.characterProfileUpdateMethod = 'toolCalls';
		const callbacks = makeCallbacks();
		queue.push({ toolCalls: [{ name: 'Elena Vale', state: 'Direct' }] });

		await generateCharacterProfiles(newSummary, withTools(state(), callbacks), prompts);

		const terminalLog = vi.mocked(callbacks.onPhaseComplete).mock.calls[0][1].profileCompressionLog!;
		expect(terminalLog).toContain(`## ${t('pipeline.compressorStages.toolsDirect')}`);
		expect(terminalLog).not.toContain('Tool fallback');
	});

	it('clears the attempt observer when the phase start callback throws', async () => {
		// WHY: a throwing UI callback must not leave the compressor mutating a stale
		// observer after the phase has already failed.
		const callbacks = makeCallbacks();
		callbacks.onPhaseStart = vi.fn(() => {
			throw new Error('ui down');
		});
		const compression = state();

		await expect(generateCharacterProfiles(newSummary, withTools(compression, callbacks), prompts)).rejects.toThrow('ui down');
		expect(compression.onAttempt).toBeUndefined();
	});

	it('retries restore the full log with a localized retry entry after the generic callback text', async () => {
		// WHY: the generic retry text overwrites the chip content; the compressor must
		// re-emit its committed attempts so a retry cannot erase them.
		mockSettings.characterProfileUpdateMethod = 'toolCalls';
		const events: string[] = [];
		const callbacks = makeCallbacks();
		callbacks.onPhaseRetry = vi.fn((_phase, attempt, maxAttempts) => {
			events.push('retry');
			expect([attempt, maxAttempts]).toEqual([2, 3]);
		});
		callbacks.onPhaseStream = vi.fn((_phase, streamState) => {
			events.push(`stream:${streamState.content}`);
		});
		queue.push({ toolCalls: [{ name: 'Elena Vale', state: 'Retried' }], retry: { attempt: 2, maxAttempts: 3 } });

		await generateCharacterProfiles(newSummary, withTools(state(), callbacks), prompts);

		const retryIndex = events.indexOf('retry');
		expect(retryIndex).toBeGreaterThanOrEqual(0);
		const restored = events.slice(retryIndex + 1).find((event) => event.startsWith('stream:')) ?? '';
		expect(restored).toContain('### Elena Vale');
		expect(restored).toContain('## Retrying');
	});

	it('aggregates three completed stages once, unioning stage and provider models', async () => {
		queue.push({
			text: 'garbage',
			metadata: meta({
				usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5, cacheReadTokens: 7 },
				durationMs: 4,
				models: new Set(['gen-model']),
			}),
		});
		queue.push({
			text: 'still garbage',
			metadata: meta({
				usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12, cacheReadTokens: 11 },
				durationMs: 6,
				models: new Set(['repair-model']),
			}),
		});
		queue.push({
			toolCalls: [{ name: 'Elena Vale', state: 'Aggregated' }],
			metadata: meta({
				usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7, cacheWriteTokens: 9 },
				durationMs: 8,
				models: new Set(['tools-model']),
			}),
		});
		const callbacks = makeCallbacks();

		const result = await generateCharacterProfiles(newSummary, withTools(state(), callbacks), prompts);

		expect(streamCalls).toHaveLength(3);
		expect(result?.metadata.usage).toMatchObject({
			inputTokens: 10,
			outputTokens: 14,
			totalTokens: 24,
			cacheReadTokens: 18,
			cacheWriteTokens: 9,
		});
		expect(result?.metadata.durationMs).toBe(18);
		expect([...(result?.metadata.models ?? [])].sort()).toEqual(['fitter-m', 'gen-model', 'repair-model', 'summarizer-m', 'tools-model']);
		expect(vi.mocked(callbacks.onPhaseComplete)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(callbacks.onPhaseComplete).mock.calls[0][2]?.usage.inputTokens).toBe(10);
	});

	it('keeps a failed request without metadata absent from the aggregate', async () => {
		queue.push({ error: new Error('provider down') });
		queue.push({
			toolCalls: [{ name: 'Elena Vale', state: 'AfterFailure' }],
			metadata: meta({ usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 }, durationMs: 9, models: new Set(['tools-model']) }),
		});
		const callbacks = makeCallbacks();

		const result = await generateCharacterProfiles(newSummary, withTools(state(), callbacks), prompts);

		expect(streamCalls).toHaveLength(2);
		expect(result?.metadata.usage.inputTokens).toBe(5);
		expect(result?.metadata.durationMs).toBe(9);
		expect([...(result?.metadata.models ?? [])].sort()).toEqual(['summarizer-m', 'tools-model']);
		const terminalLog = vi.mocked(callbacks.onPhaseComplete).mock.calls[0][1].profileCompressionLog!;
		expect(terminalLog).toContain('provider down');
	});

	it('checkpoint rejection emits one failure with details and never replays the stage', async () => {
		dbFlags.checkpointError = true;
		queue.push({ text: markdown([{ name: 'Elena Vale', fields: { state: 'Written' } }]) });
		const callbacks = makeCallbacks();
		const compression = state();

		await expect(generateCharacterProfiles(newSummary, input(compression, callbacks), prompts)).rejects.toThrow('checkpoint unavailable');

		expect(streamCalls).toHaveLength(1);
		expect(vi.mocked(callbacks.onPhaseComplete)).not.toHaveBeenCalled();
		expect(vi.mocked(callbacks.onPhaseFailed)).toHaveBeenCalledTimes(1);
		const [phase, details] = vi.mocked(callbacks.onPhaseFailed!).mock.calls[0];
		expect(phase).toBe('CHARACTER_PROFILE_COMPRESSOR');
		expect(details?.profileCompressionLog).toContain('### Elena Vale');
		expect(details?.profileCompressionLog).toContain('## Failed');
		expect(details?.profileCompressionLog).toContain('checkpoint unavailable');
		expect(details?.metadata?.usage.inputTokens).toBe(1);
		expect(await snapshotCount(9)).toBe(1); // written rows are not rolled back
		expect(await getLastCompressionScene(LINE)).toBeNull();
		expect(compression.onAttempt).toBeUndefined();
	});

	it('identity lookup rejection during validation does not repair or fall back', async () => {
		dbFlags.lookupError = true;
		queue.push({ text: markdown([{ name: 'Elena Vale', fields: { state: 'Rejected' } }]) });
		const callbacks = makeCallbacks();

		await expect(generateCharacterProfiles(newSummary, input(state(), callbacks), prompts)).rejects.toThrow('profile lookup unavailable');

		expect(streamCalls).toHaveLength(1);
		expect(vi.mocked(callbacks.onPhaseFailed)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(callbacks.onPhaseComplete)).not.toHaveBeenCalled();
		expect(await snapshotCount(9)).toBe(0);
		expect(await getLastCompressionScene(LINE)).toBeNull();
	});

	it('baseline lookup rejection creates no phase and no failure event', async () => {
		dbFlags.baselineError = true;
		const callbacks = makeCallbacks();

		await expect(generateCharacterProfiles(newSummary, input(state(), callbacks), prompts)).rejects.toThrow('baseline unavailable');

		expect(streamCalls).toHaveLength(0);
		expect(callbacks.onPhaseStart).not.toHaveBeenCalled();
		expect(callbacks.onPhaseFailed).not.toHaveBeenCalled();
	});

	it('profile write failure completes with a failure log, no checkpoint and no repair', async () => {
		dbFlags.writeError = true;
		queue.push({ text: markdown([{ name: 'Elena Vale', fields: { state: 'Lost' } }]) });
		const callbacks = makeCallbacks();
		const compression = state();

		const result = await generateCharacterProfiles(newSummary, input(compression, callbacks), prompts);

		expect(result).toBeNull();
		expect(streamCalls).toHaveLength(1);
		expect(compression.attemptCount).toBe(1);
		expect(compression.successCount).toBe(0);
		expect(await getLastCompressionScene(LINE)).toBeNull();
		expect(vi.mocked(callbacks.onPhaseFailed)).not.toHaveBeenCalled();
		const terminalLog = vi.mocked(callbacks.onPhaseComplete).mock.calls[0][1].profileCompressionLog!;
		expect(terminalLog).toContain('## Failed');
		expect(terminalLog).toContain('Elena Vale');
		expect(compression.onAttempt).toBeUndefined();
	});

	it('a failed first write never triggers repair and later writes still checkpoint', async () => {
		mockSettings.characterProfileUpdateMethod = 'toolCalls';
		queue.push({ toolCalls: [{ name: '' }, { name: 'Elena Vale', state: 'Second' }] });
		const compression = state();
		const callbacks = makeCallbacks();

		const result = await generateCharacterProfiles(newSummary, withTools(compression, callbacks), prompts);

		expect(result).not.toBeNull();
		expect(streamCalls).toHaveLength(1);
		expect(compression.attemptCount).toBe(2);
		expect(compression.successCount).toBe(1);
		expect(await getLastCompressionScene(LINE)).toBe(9);
		const terminalLog = vi.mocked(callbacks.onPhaseComplete).mock.calls[0][1].profileCompressionLog!;
		expect(terminalLog).toContain('## Applied updates');
		expect(terminalLog).toContain('## Failed');
	});

	it('a failed later write never triggers repair and the earlier success still checkpoints', async () => {
		mockSettings.characterProfileUpdateMethod = 'toolCalls';
		queue.push({ toolCalls: [{ name: 'Elena Vale', state: 'Kept' }, { name: '' }] });
		const compression = state();

		const result = await generateCharacterProfiles(newSummary, withTools(compression), prompts);

		expect(result).not.toBeNull();
		expect(streamCalls).toHaveLength(1);
		expect(compression.attemptCount).toBe(2);
		expect(compression.successCount).toBe(1);
		expect((await getLatestProfileByAlias(LINE, 'Elena Vale'))?.state).toBe('Kept');
		expect(await getLastCompressionScene(LINE)).toBe(9);
	});

	it('cancellation after generation stops before application and checkpoint', async () => {
		const controller = new AbortController();
		queue.push({ text: markdown([{ name: 'Elena Vale', fields: { state: 'Unwritten' } }]), onCall: () => controller.abort() });
		const callbacks = makeCallbacks();
		const compression = state();

		await expect(generateCharacterProfiles(newSummary, input(compression, callbacks, controller.signal), prompts)).rejects.toThrow();

		expect(streamCalls).toHaveLength(1);
		expect(await snapshotCount(9)).toBe(0);
		expect(await getLastCompressionScene(LINE)).toBeNull();
		expect(compression.attemptCount).toBe(0);
		expect(vi.mocked(callbacks.onPhaseComplete)).not.toHaveBeenCalled();
		expect(vi.mocked(callbacks.onPhaseFailed)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(callbacks.onPhaseFailed!).mock.calls[0][1]?.profileCompressionLog).toContain('## Cancelled');
		expect(compression.onAttempt).toBeUndefined();
	});

	it('cancellation before the repair stage stops without another request', async () => {
		const controller = new AbortController();
		queue.push({ text: 'garbage', onCall: () => controller.abort() });
		const callbacks = makeCallbacks();

		await expect(generateCharacterProfiles(newSummary, input(state(), callbacks, controller.signal), prompts)).rejects.toThrow();

		expect(streamCalls).toHaveLength(1);
		expect(vi.mocked(callbacks.onPhaseFailed)).toHaveBeenCalledTimes(1);
		expect(await getLastCompressionScene(LINE)).toBeNull();
	});
});
