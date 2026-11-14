import { describe, it, expect, vi, beforeAll } from 'vitest';

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

// The compressor baseline renders alias/importance values through real ls() interpolation
// (aliasesValueLabel etc.), which the definitions mocks above do not cover. Load the bundled en
// strings so those values render; mock the logger to suppress the bundled-YAML fallback warning.
vi.mock('#lib/logging/logger.ts', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {}),
	},
	fileLog: vi.fn(async () => {}),
}));

import { formatExistingProfilesForCompressor } from '#lib/ai/pipeline/message-builder.ts';
import type { CharacterProfileEntity } from '#lib/db/character-profiles.ts';
import { loadLocaleStrings } from '#lib/localization/index.ts';

beforeAll(async () => {
	await loadLocaleStrings('en');
});

function profile(overrides: Partial<CharacterProfileEntity> = {}): CharacterProfileEntity {
	return {
		id: 'p1',
		actLineId: 'line-1',
		sceneNumber: 5,
		canonicalName: 'elena-vale',
		preferredName: 'Elena Vale',
		aliases: ['Elena Vale', 'Lady Vale'],
		logline: 'A wary scout',
		state: null,
		goal: null,
		relationships: null,
		voice: null,
		traits: [],
		sceneDetails: '- 5: Arrives',
		importance: 2,
		removed: false,
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

describe('formatExistingProfilesForCompressor', () => {
	it('renders the canonical name for identity-keyed updates', () => {
		const [section] = formatExistingProfilesForCompressor([profile()]);
		expect(section).toContain('elena-vale');
		expect(section).toContain('Elena Vale');
		expect(section).toContain('Lady Vale');
	});

	it('excludes scene details (compressor rebuilds them)', () => {
		const [section] = formatExistingProfilesForCompressor([profile()]);
		expect(section).not.toContain('Arrives');
	});

	it('returns empty for no profiles', () => {
		expect(formatExistingProfilesForCompressor([])).toEqual([]);
	});
});

// --- Compressor shared-prefix layout (step 1) ---

const compressionCalls: { system: string; messages: { role: string; content: string }[]; tools: Record<string, unknown> | undefined }[] =
	[];
vi.mock('#lib/ai/chat-stream.ts', () => ({
	DEFAULT_RETRY_CONFIG: { retryCount: 2, backoffIntervalSeconds: 2 },
	streamWithRetry: vi.fn(
		async (_system: string, _messages: { role: string; content: string }[], options: { tools?: Record<string, unknown> }) => {
			compressionCalls.push({ system: _system, messages: _messages, tools: options.tools });
			return {
				state: { content: '', reasoning: null, variables: null },
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
vi.mock('#lib/db/act-lines.ts', () => ({
	getLastCompressionScene: vi.fn(async () => 0),
	recordCharacterProfileCompression: vi.fn(async () => {}),
}));
vi.mock('#lib/db/character-profiles.ts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/db/character-profiles.ts')>();
	return { ...actual, getLatestProfilesByActLine: vi.fn(async () => [profile()]), insertCharacterProfile: vi.fn(async () => {}) };
});

import type { ProfileCompressionState, PipelineContext } from '#lib/ai/pipeline/types.ts';
import { generateCharacterProfiles, type SummarizerPrompts } from '#lib/ai/pipeline/summarizer.ts';
import { parseActSummary } from '#lib/ai/act-summary-parser.ts';
import { SIDE_EFFECTING_TOOLS } from '#lib/ai/tools/phase-guard.ts';
import { PHASE_TOOLS } from '#lib/ai/tools/tools.ts';

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

describe('compressor shared-prefix layout (step 1)', () => {
	it('uses shared system + prefix + tail (new summary, profiles with canonical, role prompt)', async () => {
		const compression: ProfileCompressionState = { completedScenes: 9, newActSummary: undefined, attemptCount: 0, successCount: 0 };
		const newSummary = parseActSummary(
			'# Act Summary\n\n## Scene Summaries\n\n### Scene 9: The Gate\n- Location: Gate\n- Summary: They arrive.'
		);
		await generateCharacterProfiles(
			newSummary,
			{
				actLineId: 'line-1',
				completedScenes: 9,
				assistant: { messageId: 'msg-10', messageSequence: 10 },
				providerConfig: { model: 'm' } as never,
				abortSignal: new AbortController().signal,
				context,
				tools: undefined,
				compression,
			},
			prompts
		);
		const { system, messages } = compressionCalls[0];
		expect(system).toBe('SHARED-SYSTEM GEN-INSTR');
		const contents = messages.map((m) => m.content);
		expect(contents[0]).toContain('WORLD-BODY');
		expect(contents.some((c) => c.includes('Scene 9: The Gate'))).toBe(true);
		expect(contents.some((c) => c.includes('elena-vale'))).toBe(true);
		expect(contents[contents.length - 1]).toContain('COMPRESSOR-ROLE');
	});

	it('registers update-character-profile as side-effecting, allowed only for the compressor', () => {
		expect(SIDE_EFFECTING_TOOLS.has('update-character-profile')).toBe(true);
		expect(PHASE_TOOLS.CHARACTER_PROFILE_COMPRESSOR).toContain('update-character-profile');
		for (const [phase, allowed] of Object.entries(PHASE_TOOLS)) {
			if (phase !== 'CHARACTER_PROFILE_COMPRESSOR') expect(allowed).not.toContain('update-character-profile');
		}
	});
});

it('fills the holder with the new act summary before the executor runs', async () => {
	const compression: ProfileCompressionState = { completedScenes: 9, newActSummary: undefined, attemptCount: 0, successCount: 0 };
	let seen: unknown;
	const { streamWithRetry } = await import('#lib/ai/chat-stream.ts');
	vi.mocked(streamWithRetry).mockImplementationOnce(async () => {
		seen = compression.newActSummary;
		return {
			state: { content: '', reasoning: null, variables: null },
			resultMetadata: Promise.resolve({
				finishReason: 'stop',
				usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
				durationMs: 1,
				models: new Set(['m']),
			}),
			callbacks: {},
		} as never;
	});
	const newSummary = parseActSummary(
		'# Act Summary\n\n## Scene Summaries\n\n### Scene 9: The Gate\n- Location: Gate\n- Summary: They arrive.'
	);
	await generateCharacterProfiles(
		newSummary,
		{
			actLineId: 'line-1',
			completedScenes: 9,
			assistant: { messageId: 'msg-10', messageSequence: 10 },
			providerConfig: { model: 'm' } as never,
			abortSignal: new AbortController().signal,
			context,
			tools: undefined,
			compression,
		},
		prompts
	);
	expect(seen).toBe(newSummary);
});
