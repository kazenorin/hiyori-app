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
