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

import { createTestDatabase } from '../../../__tests__/helpers/test-database';
import { runMigrations } from '#lib/db/migrations.ts';

let testDb: ReturnType<typeof createTestDatabase>;
vi.mock('#lib/db/database.ts', () => ({
	initDatabase: vi.fn(async () => testDb),
	getDatabase: vi.fn(() => testDb),
}));

let scriptedCalls: Record<string, unknown>[] = [];
vi.mock('#lib/ai/chat-stream.ts', () => ({
	DEFAULT_RETRY_CONFIG: { retryCount: 2, backoffIntervalSeconds: 2 },
	streamWithRetry: vi.fn(
		async (
			_system: string,
			_messages: never[],
			options: {
				tools?: Record<string, { execute: (i: never, c: never) => Promise<string> }>;
				onProgress?: (s: { content: string; reasoning: string | null; variables: null }) => void;
			}
		) => {
			options.onProgress?.({ content: '', reasoning: 'compressor thoughts', variables: null });
			for (const call of scriptedCalls) {
				await options.tools!['update-character-profile'].execute(call as never, {} as never);
			}
			return {
				state: { content: '', reasoning: 'compressor thoughts', variables: null },
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
vi.mock('#lib/stores/settings.svelte.ts', () => ({
	getSettings: () => ({ characterProfileCompressorInterval: 5 }),
	isMemoryAvailable: () => false,
}));

import { generateCharacterProfiles } from '#lib/ai/pipeline/summarizer.ts';
import { buildUpdateCharacterProfileTools } from '#lib/ai/tools/update-character-profile.ts';
import { insertCharacterProfile } from '#lib/db/character-profiles.ts';
import { parseActSummary } from '#lib/ai/act-summary-parser.ts';
import { loadLocaleStrings } from '#lib/localization/index.ts';
import type { ProfileCompressionState, PipelineContext, PipelineCallbacks } from '#lib/ai/pipeline/types.ts';

const LINE = 'line-1';
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

function run(compression: ProfileCompressionState, callbacks?: PipelineCallbacks) {
	const tools = buildUpdateCharacterProfileTools({ story: { id: 's' }, actLine: { id: LINE }, act: { id: 'a' } } as never, compression);
	return generateCharacterProfiles(
		newSummary,
		{
			actLineId: LINE,
			completedScenes: 9,
			assistant: { messageId: 'msg-10', messageSequence: 10 },
			providerConfig: { model: 'm' } as never,
			abortSignal: new AbortController().signal,
			context,
			tools,
			compression,
			callbacks,
		},
		prompts
	);
}

beforeEach(async () => {
	testDb = createTestDatabase();
	await runMigrations();
	await loadLocaleStrings('en');
	scriptedCalls = [];
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

describe('compressor streaming lifecycle', () => {
	it('streams the per-character parameter log and completes with it', async () => {
		// WHY: the pane's output is the tool activity — supplied parameters per
		// character — not model prose.
		scriptedCalls = [{ name: 'elena-vale', state: 'Recovered' }];
		const callbacks = makeCallbacks();
		const compression: ProfileCompressionState = { completedScenes: 9, newActSummary: undefined, attemptCount: 0, successCount: 0 };
		await run(compression, callbacks);

		expect(callbacks.onPhaseStart).toHaveBeenCalledWith('CHARACTER_PROFILE_COMPRESSOR');
		const streamContents = vi.mocked(callbacks.onPhaseStream).mock.calls.map((c) => c[1].content);
		expect(streamContents.some((c) => c.includes('### elena-vale') && c.includes('- state: Recovered'))).toBe(true);
		const [phase, state, metadata] = vi.mocked(callbacks.onPhaseComplete).mock.calls[0];
		expect(phase).toBe('CHARACTER_PROFILE_COMPRESSOR');
		expect(state.profileCompressionLog).toContain('### elena-vale');
		expect(state.profileCompressionLog).toContain('Profile updated for elena-vale at scene 9.');
		expect(metadata?.usage.inputTokens).toBe(1);
		expect(compression.onAttempt).toBeUndefined();
	});

	it('quiet run completes with the no-changes marker (allowEmptyText)', async () => {
		const callbacks = makeCallbacks();
		const compression: ProfileCompressionState = { completedScenes: 9, newActSummary: undefined, attemptCount: 0, successCount: 0 };
		const result = await run(compression, callbacks);
		expect(result).not.toBeNull();
		const state = vi.mocked(callbacks.onPhaseComplete).mock.calls[0][1];
		expect(state.profileCompressionLog).toBe('No profile changes — the new material did not justify any updates.');
	});

	it('all-failed run still completes the chip with the failure log (D10)', async () => {
		scriptedCalls = [{ name: '' }];
		const callbacks = makeCallbacks();
		const compression: ProfileCompressionState = { completedScenes: 9, newActSummary: undefined, attemptCount: 0, successCount: 0 };
		const result = await run(compression, callbacks);
		expect(result).toBeNull(); // not recorded — D4 matrix preserved
		expect(callbacks.onPhaseComplete).toHaveBeenCalledTimes(1);
		const state = vi.mocked(callbacks.onPhaseComplete).mock.calls[0][1];
		expect(state.profileCompressionLog).toContain('Profile update failed');
	});

	it('observer throw never fails the update', async () => {
		scriptedCalls = [{ name: 'elena-vale', state: 'Recovered' }];
		const compression: ProfileCompressionState = {
			completedScenes: 9,
			newActSummary: undefined,
			attemptCount: 0,
			successCount: 0,
			onAttempt: () => {
				throw new Error('UI blew up');
			},
		};
		// run() installs its own observer only when callbacks are present; here we
		// pre-install a throwing one and pass no callbacks, so it stays in place.
		await run(compression, undefined);
		expect(compression.successCount).toBe(1);
	});
});
