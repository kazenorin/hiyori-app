import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/localization', () => ({
	ls: (key: string, opts?: Record<string, unknown>) => {
		if (key === 'pipeline.labels.lastSeen' && opts) return `last seen: scene ${opts.sceneNumber}`;
		if (key === 'pipeline.labels.noDescription') return 'No description available.';
		if (key === 'tools.characterDetails.output.sceneDetails') return 'Scene Details';
		if (key === 'pipeline.labels.sceneDetails') return 'Scene Details';
		const map: Record<string, string> = {
			'common.descriptions.characterProfiles': 'Profiles of characters.',
			'common.descriptions.characterProfilesInline': 'Inline profiles:',
			'common.descriptions.characterProfilesOther': 'Other Characters',
			'pipeline.headers.characterProfiles': 'Character Profiles',
			'pipeline.labels.importanceLevels.1': 'Protagonist',
			'pipeline.labels.importanceLevels.2': 'Main',
			'pipeline.labels.importanceLevels.3': 'Supporting',
			'pipeline.labels.importanceLevels.4': 'Minor',
		};
		return map[key] ?? key;
	},
}));

vi.mock('$lib/definitions/common-headers', () => {
	const stub = () => 'header';
	return {
		sectionFormat: (text: string, level: number = 2) => '#'.repeat(level) + ' ' + text + '\n\n',
		worldContentHeader: stub,
		actPlotHeader: stub,
		actSummaryHeader: stub,
		turnOfEventsHeader: stub,
		summaryHeader: stub,
		playerResponseHeader: stub,
		scenePlotHeader: stub,
		writerOutputTemplateHeader: stub,
		writerOutputHeader: stub,
		gameDataHeader: stub,
		storySoFarHeader: stub,
		characterProfilesHeader: () => 'Character Profiles',
		actPhaseHeader: stub,
		sceneTitleHeader: stub,
		backgroundHeader: stub,
		narrativeBodyHeader: stub,
		cgHeader: stub,
		currentSceneHeader: stub,
		interviewTranscriptHeader: stub,
		actSummaryForScenesHeader: stub,
		otherDirectorNotesHeader: stub,
		targetWordCountPerSceneHeader: stub,
		actDescriptionHeader: stub,
		characterHeader: stub,
	};
});

vi.mock('$lib/definitions/common-labels', () => ({
	actWithNumberLabel: (n: number) => `Act ${n}`,
	aliasesLabel: () => 'Aliases',
	sceneWithNumberLabel: (n: number | string) => `Scene ${n}`,
	locationLabel: () => 'Location',
	lastUpdateLabel: () => 'Last update',
}));

vi.mock('$lib/definitions/character-profile-labels', () => ({
	stateLabel: () => 'State',
	goalLabel: () => 'Goal',
	relationshipsLabel: () => 'Relationships',
	voiceLabel: () => 'Voice',
	importanceLabel: () => 'Importance',
}));

import { formatCharacterProfilesSection } from '$lib/definitions/pipeline-sections';
import type { CharacterProfileEntity } from '$lib/db/character-profiles';

function makeProfile(overrides: Partial<CharacterProfileEntity> = {}): CharacterProfileEntity {
	return {
		id: 'p1',
		actLineId: 'line-1',
		sceneNumber: 5,
		canonicalName: 'elena',
		preferredName: 'Elena',
		aliases: [],
		state: 'Determined hero.',
		goal: null,
		relationships: null,
		voice: null,
		sceneDetails: '',
		importance: 2,
		createdAt: 1000,
		updatedAt: 1000,
		...overrides,
	};
}

describe('formatCharacterProfilesSection', () => {
	it('returns empty array when no profiles', () => {
		const result = formatCharacterProfilesSection([], 2, 5);
		expect(result).toEqual([]);
	});

	it('inlines profiles with importance <= threshold', () => {
		const profiles = [
			makeProfile({ id: 'p1', preferredName: 'Elena', importance: 2 }),
			makeProfile({ id: 'p2', preferredName: 'Voss', importance: 4 }),
		];

		const result = formatCharacterProfilesSection(profiles, 2, 5);
		expect(result).toHaveLength(1);
		expect(result[0]).toContain('### Elena');
		expect(result[0]).not.toContain('### Voss');
		expect(result[0]).toContain('Voss');
	});

	it('respects maxIncluded cap', () => {
		const profiles = [
			makeProfile({ id: 'p1', preferredName: 'A', importance: 1 }),
			makeProfile({ id: 'p2', preferredName: 'B', importance: 1 }),
			makeProfile({ id: 'p3', preferredName: 'C', importance: 1 }),
		];

		const result = formatCharacterProfilesSection(profiles, 2, 2);
		expect(result[0]).toContain('### A');
		expect(result[0]).toContain('### B');
		expect(result[0]).not.toContain('### C');
		expect(result[0]).toContain('C');
	});

	it('includes aliases when present', () => {
		const profile = makeProfile({ aliases: ['Shadow', 'E'] });
		const result = formatCharacterProfilesSection([profile], 2, 5);
		expect(result[0]).toContain('- Aliases: [Shadow, E]');
	});

	it('includes sceneDetails when present', () => {
		const profile = makeProfile({ sceneDetails: 'Scene 3: Elena fights.' });
		const result = formatCharacterProfilesSection([profile], 2, 5);
		expect(result[0]).toContain('**Scene Details**:');
		expect(result[0]).toContain('Scene 3: Elena fights.');
	});

	it('does not include sceneDetails section when empty', () => {
		const profile = makeProfile({ sceneDetails: '' });
		const result = formatCharacterProfilesSection([profile], 2, 5);
		expect(result[0]).not.toContain('Scene Details');
	});

	it('renders referenced profiles as one-line entries with scene info', () => {
		const profiles = [
			makeProfile({ id: 'p1', preferredName: 'Elena', importance: 1, sceneNumber: 5 }),
			makeProfile({ id: 'p2', preferredName: 'Voss', importance: 4, sceneNumber: 10, state: 'A gruff captain.' }),
		];

		const result = formatCharacterProfilesSection(profiles, 2, 5);
		expect(result[0]).toContain('- Voss [Minor] (last seen: scene 10): A gruff captain.');
	});

	it('renders referenced profiles without scene info when sceneNumber is null', () => {
		const profiles = [
			makeProfile({ id: 'p1', preferredName: 'Elena', importance: 1 }),
			makeProfile({ id: 'p2', preferredName: 'Voss', importance: 4, sceneNumber: null, state: 'A captain.' }),
		];

		const result = formatCharacterProfilesSection(profiles, 2, 5);
		expect(result[0]).toContain('- Voss [Minor]: A captain.');
		expect(result[0]).not.toContain('last seen');
	});

	it('sorts inline by importance ascending then scene descending', () => {
		const profiles = [
			makeProfile({ id: 'p1', preferredName: 'LateMain', importance: 2, sceneNumber: 10 }),
			makeProfile({ id: 'p2', preferredName: 'EarlyMain', importance: 2, sceneNumber: 3 }),
			makeProfile({ id: 'p3', preferredName: 'Protag', importance: 1, sceneNumber: 5 }),
		];

		const result = formatCharacterProfilesSection(profiles, 2, 5);
		const protagIdx = result[0].indexOf('### Protag');
		const lateMainIdx = result[0].indexOf('### LateMain');
		const earlyMainIdx = result[0].indexOf('### EarlyMain');
		expect(protagIdx).toBeLessThan(lateMainIdx);
		expect(lateMainIdx).toBeLessThan(earlyMainIdx);
	});

	it('uses first non-empty profile line as one-line description', () => {
		const profile = makeProfile({
			id: 'p2',
			preferredName: 'Voss',
			importance: 4,
			state: '- A gruff captain\n\nMore detail.',
		});
		const result = formatCharacterProfilesSection([profile], 0, 0);
		expect(result[0]).toContain('A gruff captain');
	});

	it('uses fallback message when profile is empty', () => {
		const profile = makeProfile({
			id: 'p2',
			preferredName: 'Voss',
			importance: 4,
			state: '',
		});
		const result = formatCharacterProfilesSection([profile], 0, 0);
		expect(result[0]).toContain('No description available.');
	});
});
