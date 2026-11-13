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

// Suppress ls() missing-key warnings (baseline rendering uses keys the definitions
// mocks do not cover) and the compression counter logs; assertions are DB-state only.
vi.mock('#lib/logging/logger.ts', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {}),
	},
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
let executorError: Error | undefined;
vi.mock('#lib/ai/pipeline/phase-executor.ts', () => ({
	runNonStreamingPhase: vi.fn(
		async (
			phase: string,
			system: string,
			messages: never[],
			config: unknown,
			signal: unknown,
			tools: Record<string, { execute: (i: never, c: never) => Promise<string> }> | undefined
		) => {
			if (executorError) throw executorError;
			for (const call of scriptedCalls) {
				await tools!['update-character-profile'].execute(call as never, {} as never);
			}
			return {
				text: '',
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
vi.mock('#lib/stores/settings.svelte.ts', () => ({
	getSettings: () => ({ characterProfileCompressorInterval: 5 }),
	isMemoryAvailable: () => false,
}));

import { generateCharacterProfiles } from '#lib/ai/pipeline/summarizer.ts';
import { buildUpdateCharacterProfileTools } from '#lib/ai/tools/update-character-profile.ts';
import { insertCharacterProfile, getLatestProfilesByActLine, getLatestProfileByAlias } from '#lib/db/character-profiles.ts';
import { getLastCompressionScene } from '#lib/db/act-lines.ts';
import { parseActSummary } from '#lib/ai/act-summary-parser.ts';
import { PHASE_TOOLS } from '#lib/ai/tools/tools.ts';
import type { ProfileCompressionState, PipelineContext } from '#lib/ai/pipeline/types.ts';

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

function run(compression: ProfileCompressionState) {
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
		},
		prompts
	);
}

beforeEach(async () => {
	testDb = createTestDatabase();
	await runMigrations();
	scriptedCalls = [];
	executorError = undefined;
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

describe('compressor recording matrix (D4)', () => {
	it('zero calls (quiet run) records and closes the gate', async () => {
		const result = await run({ completedScenes: 9, newActSummary: undefined, attemptCount: 0, successCount: 0 });
		expect(result).not.toBeNull();
		expect(await getLastCompressionScene(LINE)).toBe(9);
		const profiles = await getLatestProfilesByActLine(LINE);
		expect(profiles[0].sceneNumber).toBe(4); // unchanged profile keeps its version (F5)
	});

	it('partial success records; failed character does not block the rest', async () => {
		scriptedCalls = [{ name: 'elena-vale', state: 'Recovered' }, { name: '' }];
		const result = await run({ completedScenes: 9, newActSummary: undefined, attemptCount: 0, successCount: 0 });
		expect(result).not.toBeNull();
		expect(await getLastCompressionScene(LINE)).toBe(9);
		const latest = await getLatestProfileByAlias(LINE, 'Elena Vale');
		expect(latest?.state).toBe('Recovered');
		expect(latest?.sceneNumber).toBe(9);
	});

	it('all attempts failed: no recording, gate stays open', async () => {
		scriptedCalls = [{ name: '' }];
		const result = await run({ completedScenes: 9, newActSummary: undefined, attemptCount: 0, successCount: 0 });
		expect(result).toBeNull();
		expect(await getLastCompressionScene(LINE)).toBeNull();
	});

	it('executor error/abort: no recording', async () => {
		executorError = new Error('aborted');
		await expect(run({ completedScenes: 9, newActSummary: undefined, attemptCount: 0, successCount: 0 })).rejects.toThrow();
		expect(await getLastCompressionScene(LINE)).toBeNull();
	});

	it('allow-list flipped for the compressor only', () => {
		expect(PHASE_TOOLS.CHARACTER_PROFILE_COMPRESSOR).toContain('update-character-profile');
		expect(PHASE_TOOLS.SUMMARIZER).not.toContain('update-character-profile');
		expect(PHASE_TOOLS.WRITER).not.toContain('update-character-profile');
	});
});
