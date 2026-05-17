import { describe, it, expect, vi } from 'vitest';

const mockActSummaryHeader = vi.fn(() => 'Act Summary');
const mockTurnOfEventsHeader = vi.fn(() => 'Turn Of Events');
const mockSummaryHeader = vi.fn(() => 'Summary');
const mockLocationLabel = vi.fn(() => 'Location');
const mockAliasesLabel = vi.fn(() => 'Aliases');
const mockSceneWithNumberLabel = vi.fn((n: number | string) => `Scene ${n}`);
const mockSceneSummariesHeader = vi.fn(() => 'Scene Summaries');
const mockCharacterSummariesHeader = vi.fn(() => 'Character Summaries');
const mockCharacterProfilesHeader = vi.fn(() => 'Character Profiles');
const mockLastUpdateLabel = vi.fn(() => 'Last update');
const mockStateLabel = vi.fn(() => 'State');
const mockGoalLabel = vi.fn(() => 'Goal');
const mockRelationshipsLabel = vi.fn(() => 'Relationships');
const mockVoiceLabel = vi.fn(() => 'Voice');
const mockCharacterSummariesSinceSceneLabel = vi.fn((n: number) => `Summaries of each character for recent Scenes since Scene ${n}.`);

vi.mock('$lib/definitions/common-headers', () => ({
	actSummaryHeader: () => mockActSummaryHeader(),
	turnOfEventsHeader: () => mockTurnOfEventsHeader(),
	summaryHeader: () => mockSummaryHeader(),
	sectionFormat: (text: string, headerLevel: number = 2) => '#'.repeat(headerLevel) + ' ' + text + '\n\n',
}));

vi.mock('$lib/definitions/common-labels', () => ({
	sceneWithNumberLabel: (n: number | string) => mockSceneWithNumberLabel(n),
	locationLabel: () => mockLocationLabel(),
	aliasesLabel: () => mockAliasesLabel(),
	lastUpdateLabel: () => mockLastUpdateLabel(),
	stateLabel: () => mockStateLabel(),
	goalLabel: () => mockGoalLabel(),
	relationshipsLabel: () => mockRelationshipsLabel(),
	voiceLabel: () => mockVoiceLabel(),
}));

vi.mock('$lib/definitions/pipeline-prompts', () => ({
	sceneSummariesHeader: () => mockSceneSummariesHeader(),
	characterSummariesHeader: () => mockCharacterSummariesHeader(),
	characterProfilesHeader: () => mockCharacterProfilesHeader(),
	characterSummariesSinceSceneLabel: (n: number) => mockCharacterSummariesSinceSceneLabel(n),
}));

vi.mock('$lib/logging/logger', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {}),
	},
}));

import {
	parseActSummary,
	serializeActSummary,
	serializeCompressedActSummary,
	parseIncrementalOutput,
	parseProfilesBody,
	pruneCharacterScenes,
	mergeActSummary,
	type ActSummary,
	type IncrementalUpdate,
} from '../ai/act-summary-parser';

const SAMPLE_ACT_SUMMARY = `## Scene Summaries
### Scene 1: The Arrival
Location: A coastal village
Summary: The hero arrives at a coastal village seeking answers about their past.

### Scene 2: The Tavern
Location: The Salty Dog tavern
Summary: The hero meets a mysterious stranger who offers a map.

## Character Summaries
### Elena Shadowcrest
- Aliases: [Elena, The Shadow]
- Scene 1: Elena watches the hero from the shadows.
- Scene 2: Elena reveals she knows about the hero's past.

### Captain Voss
- Aliases: [Voss]
- Scene 2: Voss offers the hero passage on his ship.`;

describe('parseActSummary', () => {
	it('parses a complete act summary with all sections', () => {
		const result = parseActSummary(SAMPLE_ACT_SUMMARY);

		expect(result.completedScenes).toBe(0);
		expect(result.scenes).toHaveLength(2);

		expect(result.scenes[0]).toEqual({
			sceneNumber: 1,
			title: 'The Arrival',
			location: 'A coastal village',
			summary: 'The hero arrives at a coastal village seeking answers about their past.',
		});

		expect(result.scenes[1]).toEqual({
			sceneNumber: 2,
			title: 'The Tavern',
			location: 'The Salty Dog tavern',
			summary: 'The hero meets a mysterious stranger who offers a map.',
		});

		expect(result.characters).toHaveLength(2);
		expect(result.characters[0]).toEqual({
			characterName: 'Elena Shadowcrest',
			aliases: ['Elena', 'The Shadow'],
			sceneEntries: [
				{ sceneNumber: 1, summary: 'Elena watches the hero from the shadows.' },
				{ sceneNumber: 2, summary: "Elena reveals she knows about the hero's past." },
			],
		});
		expect(result.characters[1]).toEqual({
			characterName: 'Captain Voss',
			aliases: ['Voss'],
			sceneEntries: [{ sceneNumber: 2, summary: 'Voss offers the hero passage on his ship.' }],
		});
	});

	it('parses empty markdown', () => {
		const result = parseActSummary('');
		expect(result.completedScenes).toBe(0);
		expect(result.scenes).toHaveLength(0);
		expect(result.characters).toHaveLength(0);
	});

	it('parses act summary with missing scene summaries section', () => {
		const markdown = `## Character Summaries
### Alice
- Aliases: [Ali]
- Scene 1: Alice appeared.`;

		const result = parseActSummary(markdown);
		expect(result.completedScenes).toBe(0);
		expect(result.scenes).toHaveLength(0);
		expect(result.characters).toHaveLength(1);
	});

	it('parses act summary with missing character summaries section', () => {
		const markdown = `## Scene Summaries
### Scene 1: Beginning
Location: Start
Summary: The start.`;

		const result = parseActSummary(markdown);
		expect(result.completedScenes).toBe(0);
		expect(result.scenes).toHaveLength(1);
		expect(result.characters).toHaveLength(0);
	});

	it('handles scene with Location and Summary as paragraphs', () => {
		const markdown = `## Scene Summaries
### Scene 1: Test
Location: A place
Summary: A thing happened.

## Character Summaries
### Bob
- Scene 1: Bob was there.`;

		const result = parseActSummary(markdown);
		expect(result.scenes[0].location).toBe('A place');
		expect(result.scenes[0].summary).toBe('A thing happened.');
	});

	it('handles character aliases without brackets', () => {
		const markdown = `## Character Summaries
### Bob
- Aliases: Bobby, Robert
- Scene 1: Bob did something.`;

		const result = parseActSummary(markdown);
		expect(result.characters[0].aliases).toEqual(['Bobby', 'Robert']);
	});
});

describe('serializeActSummary', () => {
	it('serializes a complete act summary to markdown', () => {
		const data: ActSummary = {
			completedScenes: 2,
			scenes: [
				{ sceneNumber: 1, title: 'The Arrival', location: 'A coastal village', summary: 'The hero arrives.' },
				{ sceneNumber: 2, title: 'The Tavern', location: 'The Salty Dog', summary: 'The hero meets a stranger.' },
			],
			characters: [
				{
					characterName: 'Elena',
					aliases: ['Elena', 'The Shadow'],
					sceneEntries: [
						{ sceneNumber: 1, summary: 'Elena watches.' },
						{ sceneNumber: 2, summary: 'Elena reveals information.' },
					],
				},
			],
			turnOfEvents: null,
			turnOfEventsSceneNumber: null,
			turnOfEventsSceneTitle: null,
			characterProfiles: [],
			characterProfileLastScene: null,
		};

		const result = serializeActSummary(data);

		expect(result).toContain('# Act Summary');
		expect(result).toContain('## Scene Summaries');
		expect(result).toContain('### Scene 1: The Arrival');
		expect(result).toContain('Location: A coastal village');
		expect(result).toContain('Summary: The hero arrives.');
		expect(result).toContain('### Scene 2: The Tavern');
		expect(result).toContain('## Character Summaries');
		expect(result).toContain('### Elena');
		expect(result).toContain('- Aliases: [Elena, The Shadow]');
		expect(result).toContain('- Scene 1: Elena watches.');
	});

	it('serializes an empty act summary', () => {
		const data: ActSummary = {
			completedScenes: 0,
			scenes: [],
			characters: [],
			turnOfEvents: null,
			turnOfEventsSceneNumber: null,
			turnOfEventsSceneTitle: null,
			characterProfiles: [],
			characterProfileLastScene: null,
		};

		const result = serializeActSummary(data);
		expect(result).toContain('# Act Summary');
		expect(result).toContain('## Scene Summaries');
		expect(result).toContain('## Character Summaries');
	});

	it('roundtrips: parse → serialize → parse produces identical data', () => {
		const original = parseActSummary(SAMPLE_ACT_SUMMARY);
		const serialized = serializeActSummary(original);
		const reparsed = parseActSummary(serialized);

		expect(reparsed.completedScenes).toBe(0);
		expect(reparsed.scenes).toHaveLength(original.scenes.length);
		expect(reparsed.characters).toHaveLength(original.characters.length);

		for (let i = 0; i < original.scenes.length; i++) {
			expect(reparsed.scenes[i].sceneNumber).toBe(original.scenes[i].sceneNumber);
			expect(reparsed.scenes[i].title).toBe(original.scenes[i].title);
			expect(reparsed.scenes[i].location).toBe(original.scenes[i].location);
			expect(reparsed.scenes[i].summary).toBe(original.scenes[i].summary);
		}

		for (let i = 0; i < original.characters.length; i++) {
			expect(reparsed.characters[i].characterName).toBe(original.characters[i].characterName);
			expect(reparsed.characters[i].aliases).toEqual(original.characters[i].aliases);
			expect(reparsed.characters[i].sceneEntries).toHaveLength(original.characters[i].sceneEntries.length);
			for (let j = 0; j < original.characters[i].sceneEntries.length; j++) {
				expect(reparsed.characters[i].sceneEntries[j].sceneNumber).toBe(original.characters[i].sceneEntries[j].sceneNumber);
				expect(reparsed.characters[i].sceneEntries[j].summary).toBe(original.characters[i].sceneEntries[j].summary);
			}
		}
	});
	it('serializes turnOfEvents section when present', () => {
		const data: ActSummary = {
			completedScenes: 2,
			scenes: [],
			characters: [],
			turnOfEvents: null,
			turnOfEventsSceneNumber: null,
			turnOfEventsSceneTitle: null,
			characterProfiles: [],
			characterProfileLastScene: null,
		};
		expect(serializeActSummary(data)).not.toContain('## Turn Of Events');

		const withTurnOfEvents: ActSummary = {
			completedScenes: 3,
			scenes: [],
			characters: [],
			turnOfEvents: 'Shift the story toward uncovering the conspiracy.',
			turnOfEventsSceneNumber: 3,
			turnOfEventsSceneTitle: 'The Revelation',
			characterProfiles: [],
			characterProfileLastScene: null,
		};
		const result = serializeActSummary(withTurnOfEvents);
		expect(result).toContain('## Turn Of Events');
		expect(result).toContain('### Scene 3: The Revelation');
		expect(result).toContain('Shift the story toward uncovering the conspiracy.');
		// Turn Of Events should appear after Character Summaries
		const toeIdx = result.indexOf('## Turn Of Events');
		const charIdx = result.indexOf('## Character Summaries');
		expect(toeIdx).toBeGreaterThan(charIdx);
	});
});

describe('code fence stripping', () => {
	it('parses act summary wrapped in bare code fence', () => {
		const wrapped = '```\n' + SAMPLE_ACT_SUMMARY + '\n```';
		const result = parseActSummary(wrapped);
		expect(result.completedScenes).toBe(0);
		expect(result.scenes).toHaveLength(2);
		expect(result.characters).toHaveLength(2);
	});

	it('parses act summary wrapped in code fence with language tag', () => {
		const wrapped = '```markdown\n' + SAMPLE_ACT_SUMMARY + '\n```';
		const result = parseActSummary(wrapped);
		expect(result.completedScenes).toBe(0);
		expect(result.scenes).toHaveLength(2);
	});

	it('parses incremental output wrapped in code fence', () => {
		const incremental = `\`\`\`markdown
## Scene Summaries
### Scene 3: The Forest
Location: An ancient forest
Summary: The hero discovers a hidden path.

## Character Summaries
### Elena Shadowcrest
- Aliases: [Elena, The Shadow, Shadow]
- Scene 3: Elena guides the hero through the forest.
\`\`\``;

		const result = parseIncrementalOutput(incremental);
		expect(result.completedScenes).toBeUndefined();
		expect(result.newScene?.title).toBe('The Forest');
		expect(result.characterUpdates).toHaveLength(1);
	});

	it('leaves plain markdown unchanged', () => {
		const result = parseActSummary(SAMPLE_ACT_SUMMARY);
		expect(result.completedScenes).toBe(0);
		expect(result.scenes).toHaveLength(2);
	});
});

describe('parseIncrementalOutput', () => {
	it('parses an incremental update with a new scene and character updates', () => {
		const markdown = `## Scene Summaries
### Scene 3: The Forest
Location: An ancient forest
Summary: The hero discovers a hidden path through the woods.

## Character Summaries
### Elena Shadowcrest
- Aliases: [Elena, The Shadow, Shadow]
- Scene 3: Elena guides the hero through the forest.

### Forest Guide
- Aliases: [Guide]
- Scene 3: The guide offers directions at a crossroads.`;

		const result = parseIncrementalOutput(markdown);

		expect(result.completedScenes).toBeUndefined();
		expect(result.newScene).toEqual({
			sceneNumber: 3,
			title: 'The Forest',
			location: 'An ancient forest',
			summary: 'The hero discovers a hidden path through the woods.',
		});
		expect(result.characterUpdates).toHaveLength(2);
		expect(result.characterUpdates[0].characterName).toBe('Elena Shadowcrest');
		expect(result.characterUpdates[0].aliases).toEqual(['Elena', 'The Shadow', 'Shadow']);
		expect(result.characterUpdates[0].sceneEntries).toEqual([{ sceneNumber: 3, summary: 'Elena guides the hero through the forest.' }]);
		expect(result.characterUpdates[1].characterName).toBe('Forest Guide');
	});

	it('parses an incremental update with only character updates', () => {
		const markdown = `## Character Summaries
### Elena Shadowcrest
- Aliases: [Elena, The Shadow]
- Scene 2: Elena reveals information.`;

		const result = parseIncrementalOutput(markdown);
		expect(result.completedScenes).toBeUndefined();
		expect(result.newScene).toBeUndefined();
		expect(result.characterUpdates).toHaveLength(1);
	});
});

describe('mergeActSummary', () => {
	it('merges a new scene into existing summary', () => {
		const existing: ActSummary = {
			turnOfEvents: null,
			turnOfEventsSceneNumber: null,
			turnOfEventsSceneTitle: null,
			completedScenes: 2,
			scenes: [
				{ sceneNumber: 1, title: 'The Arrival', location: 'A village', summary: 'Hero arrives.' },
				{ sceneNumber: 2, title: 'The Tavern', location: 'A tavern', summary: 'Hero meets stranger.' },
			],
			characters: [
				{
					characterName: 'Elena',
					aliases: ['Elena', 'The Shadow'],
					sceneEntries: [{ sceneNumber: 1, summary: 'Elena watches.' }],
				},
			],
			characterProfiles: [],
			characterProfileLastScene: null,
		};

		const incremental: IncrementalUpdate = {
			completedScenes: 3,
			newScene: { sceneNumber: 3, title: 'The Forest', location: 'A forest', summary: 'Hero finds a path.' },
			characterUpdates: [
				{
					characterName: 'Elena',
					aliases: ['Elena', 'The Shadow', 'Shadow'],
					sceneEntries: [{ sceneNumber: 3, summary: 'Elena guides the hero.' }],
				},
			],
		};

		const merged = mergeActSummary(existing, incremental);

		expect(merged.completedScenes).toBe(3);
		expect(merged.scenes).toHaveLength(3);
		expect(merged.scenes[2].title).toBe('The Forest');
		expect(merged.characters).toHaveLength(1);
		expect(merged.characters[0].aliases).toEqual(['Elena', 'The Shadow', 'Shadow']);
		expect(merged.characters[0].sceneEntries).toHaveLength(2);
	});

	it('adds a new character to existing summary', () => {
		const existing: ActSummary = {
			turnOfEvents: null,
			turnOfEventsSceneNumber: null,
			turnOfEventsSceneTitle: null,
			completedScenes: 1,
			scenes: [{ sceneNumber: 1, title: 'Start', location: 'Town', summary: 'Beginning.' }],
			characters: [
				{
					characterName: 'Elena',
					aliases: ['Elena'],
					sceneEntries: [{ sceneNumber: 1, summary: 'Elena appears.' }],
				},
			],
			characterProfiles: [],
			characterProfileLastScene: null,
		};

		const incremental: IncrementalUpdate = {
			completedScenes: 2,
			newScene: { sceneNumber: 2, title: 'Road', location: 'Road', summary: 'Journey begins.' },
			characterUpdates: [
				{
					characterName: 'Marcus',
					aliases: ['Marcus', 'Marc'],
					sceneEntries: [{ sceneNumber: 2, summary: 'Marcus joins the party.' }],
				},
			],
		};

		const merged = mergeActSummary(existing, incremental);

		expect(merged.characters).toHaveLength(2);
		expect(merged.characters[1].characterName).toBe('Marcus');
		expect(merged.characters[1].aliases).toEqual(['Marcus', 'Marc']);
	});

	it('does not mutate existing arrays', () => {
		const existing: ActSummary = {
			turnOfEvents: null,
			turnOfEventsSceneNumber: null,
			turnOfEventsSceneTitle: null,
			completedScenes: 1,
			scenes: [{ sceneNumber: 1, title: 'Start', location: 'Town', summary: 'Beginning.' }],
			characters: [
				{
					characterName: 'Elena',
					aliases: ['Elena'],
					sceneEntries: [{ sceneNumber: 1, summary: 'Elena appears.' }],
				},
			],
			characterProfiles: [],
			characterProfileLastScene: null,
		};

		const incremental: IncrementalUpdate = {
			completedScenes: 2,
			newScene: { sceneNumber: 2, title: 'Next', location: 'Forest', summary: 'Adventure.' },
			characterUpdates: [],
		};

		const merged = mergeActSummary(existing, incremental);

		// Original should not be mutated
		expect(existing.scenes).toHaveLength(1);
		expect(existing.characters[0].sceneEntries).toHaveLength(1);
		// Merged should have 2 scenes
		expect(merged.scenes).toHaveLength(2);
	});

	it('integrates: parse + parse incremental + merge + serialize', () => {
		const existing = parseActSummary(SAMPLE_ACT_SUMMARY);

		const incrementalMarkdown = `## Scene Summaries
### Scene 3: The Forest
Location: An ancient forest
Summary: The hero discovers a hidden path.

## Character Summaries
### Elena Shadowcrest
- Aliases: [Elena, The Shadow, Shadow]
- Scene 3: Elena guides the hero through the forest.

### Forest Guide
- Aliases: [Guide]
- Scene 3: The guide offers directions.`;

		const incremental = parseIncrementalOutput(incrementalMarkdown);
		const merged = mergeActSummary(existing, incremental);
		const serialized = serializeActSummary(merged);

		expect(merged.completedScenes).toBe(0);
		expect(merged.scenes).toHaveLength(3);
		expect(merged.scenes[2].title).toBe('The Forest');
		expect(merged.characters).toHaveLength(3);

		// Elena should have merged aliases and new scene entry
		const elena = merged.characters.find((c) => c.characterName === 'Elena Shadowcrest');
		expect(elena).toBeDefined();
		expect(elena!.aliases).toContain('Shadow');
		expect(elena!.sceneEntries).toHaveLength(3);

		// Verify the serialized output can be re-parsed
		const reparsed = parseActSummary(serialized);
		expect(reparsed.completedScenes).toBe(0);
		expect(reparsed.scenes).toHaveLength(3);
		expect(reparsed.characters).toHaveLength(3);
	});

	it('preserves existing turnOfEvents during merge', () => {
		const existing: ActSummary = {
			completedScenes: 2,
			scenes: [],
			characters: [],
			turnOfEvents: 'A sudden betrayal changes everything.',
			turnOfEventsSceneNumber: 2,
			turnOfEventsSceneTitle: 'Betrayal',
			characterProfiles: [],
			characterProfileLastScene: null,
		};
		const incremental: IncrementalUpdate = {
			completedScenes: 3,
			newScene: { sceneNumber: 3, title: 'Aftermath', location: 'Castle', summary: 'Fallout from the betrayal.' },
			characterUpdates: [],
		};
		const merged = mergeActSummary(existing, incremental);
		expect(merged.turnOfEvents).toBe('A sudden betrayal changes everything.');
		expect(merged.turnOfEventsSceneNumber).toBe(2);
		expect(merged.turnOfEventsSceneTitle).toBe('Betrayal');
	});

	it('preserves existing characterProfiles and characterProfileLastScene during merge', () => {
		const existing: ActSummary = {
			completedScenes: 5,
			scenes: [],
			characters: [],
			characterProfiles: [
				{ characterName: 'Elena', state: 'Wounded', goal: 'Escape', relationships: 'Distrusts Voss', voice: 'Quiet' },
			],
			characterProfileLastScene: 5,
			turnOfEvents: null,
			turnOfEventsSceneNumber: null,
			turnOfEventsSceneTitle: null,
		};
		const incremental: IncrementalUpdate = {
			completedScenes: 6,
			newScene: { sceneNumber: 6, title: 'Escape', location: 'Dungeon', summary: 'Elena escapes.' },
			characterUpdates: [],
		};
		const merged = mergeActSummary(existing, incremental);
		expect(merged.characterProfiles).toHaveLength(1);
		expect(merged.characterProfileLastScene).toBe(5);
	});

});


describe('parseProfilesBody', () => {
	it('parses character profiles with all fields', () => {
		const body = `Last update: Scene 5
### Elena
- State: Wounded but determined
- Goal: Escape the castle
- Relationships: Distrusts Captain Voss, allied with the hero
- Voice: Quiet and measured

### Captain Voss
- State: Suspicious
- Goal: Prevent the escape
- Relationships: Hostile toward Elena
- Voice: Gruff and commanding`;

		const result = parseProfilesBody(body);
		expect(result.lastScene).toBe(5);
		expect(result.profiles).toHaveLength(2);
		expect(result.profiles[0]).toEqual({
			characterName: 'Elena',
			state: 'Wounded but determined',
			goal: 'Escape the castle',
			relationships: 'Distrusts Captain Voss, allied with the hero',
			voice: 'Quiet and measured',
		});
		expect(result.profiles[1]).toEqual({
			characterName: 'Captain Voss',
			state: 'Suspicious',
			goal: 'Prevent the escape',
			relationships: 'Hostile toward Elena',
			voice: 'Gruff and commanding',
		});
	});

	it('parses profiles without Last update metadata', () => {
		const body = `### Elena
- State: Calm
- Goal: Investigate
- Relationships: Neutral
- Voice: Steady`;

		const result = parseProfilesBody(body);
		expect(result.lastScene).toBeNull();
		expect(result.profiles).toHaveLength(1);
		expect(result.profiles[0].characterName).toBe('Elena');
	});

	it('parses empty body', () => {
		const result = parseProfilesBody('');
		expect(result.profiles).toHaveLength(0);
		expect(result.lastScene).toBeNull();
	});
});

describe('pruneCharacterScenes', () => {
	it('prunes scene entries at or before characterProfileLastScene', () => {
		const data: ActSummary = {
			completedScenes: 8,
			scenes: [
				{ sceneNumber: 1, title: 'A', location: 'X', summary: 'S1' },
				{ sceneNumber: 5, title: 'B', location: 'Y', summary: 'S5' },
				{ sceneNumber: 8, title: 'C', location: 'Z', summary: 'S8' },
			],
			characters: [
				{
					characterName: 'Elena',
					aliases: ['Elena'],
					sceneEntries: [
						{ sceneNumber: 1, summary: 'Scene 1 entry' },
						{ sceneNumber: 3, summary: 'Scene 3 entry' },
						{ sceneNumber: 5, summary: 'Scene 5 entry' },
						{ sceneNumber: 6, summary: 'Scene 6 entry' },
						{ sceneNumber: 8, summary: 'Scene 8 entry' },
					],
				},
			],
			characterProfiles: [{ characterName: 'Elena', state: 'S', goal: 'G', relationships: 'R', voice: 'V' }],
			characterProfileLastScene: 5,
			turnOfEvents: null,
			turnOfEventsSceneNumber: null,
			turnOfEventsSceneTitle: null,
		};

		const pruned = pruneCharacterScenes(data);

		expect(pruned.scenes).toHaveLength(3);
		expect(pruned.characterProfiles).toHaveLength(1);
		const elena = pruned.characters[0];
		expect(elena.sceneEntries).toHaveLength(2);
		expect(elena.sceneEntries[0].sceneNumber).toBe(6);
		expect(elena.sceneEntries[1].sceneNumber).toBe(8);
	});

	it('returns unchanged data when characterProfileLastScene is null', () => {
		const data: ActSummary = {
			completedScenes: 3,
			scenes: [],
			characters: [
				{
					characterName: 'Elena',
					aliases: ['Elena'],
					sceneEntries: [{ sceneNumber: 1, summary: 'Entry' }],
				},
			],
			characterProfiles: [],
			characterProfileLastScene: null,
			turnOfEvents: null,
			turnOfEventsSceneNumber: null,
			turnOfEventsSceneTitle: null,
		};

		const result = pruneCharacterScenes(data);
		expect(result).toBe(data);
	});

	it('does not mutate original data', () => {
		const data: ActSummary = {
			completedScenes: 6,
			scenes: [],
			characters: [
				{
					characterName: 'Elena',
					aliases: ['Elena'],
					sceneEntries: [
						{ sceneNumber: 1, summary: 'Old' },
						{ sceneNumber: 6, summary: 'New' },
					],
				},
			],
			characterProfiles: [],
			characterProfileLastScene: 3,
			turnOfEvents: null,
			turnOfEventsSceneNumber: null,
			turnOfEventsSceneTitle: null,
		};

		const pruned = pruneCharacterScenes(data);
		expect(data.characters[0].sceneEntries).toHaveLength(2);
		expect(pruned.characters[0].sceneEntries).toHaveLength(1);
	});
});

describe('serializeCompressedActSummary', () => {
	const dataWithProfiles: ActSummary = {
		completedScenes: 8,
		scenes: [
			{ sceneNumber: 1, title: 'The Arrival', location: 'Village', summary: 'Hero arrives.' },
			{ sceneNumber: 5, title: 'The Forest', location: 'Forest', summary: 'Hero finds a path.' },
			{ sceneNumber: 8, title: 'The Castle', location: 'Castle', summary: 'Hero reaches the castle.' },
		],
		characters: [
			{
				characterName: 'Elena',
				aliases: ['Elena', 'The Shadow'],
				sceneEntries: [
					{ sceneNumber: 1, summary: 'Elena watches.' },
					{ sceneNumber: 3, summary: 'Elena investigates.' },
					{ sceneNumber: 5, summary: 'Elena guides the hero.' },
					{ sceneNumber: 6, summary: 'Elena fights.' },
					{ sceneNumber: 8, summary: 'Elena escapes.' },
				],
			},
			{
				characterName: 'Voss',
				aliases: ['Voss'],
				sceneEntries: [
					{ sceneNumber: 5, summary: 'Voss attacks.' },
					{ sceneNumber: 7, summary: 'Voss retreats.' },
					{ sceneNumber: 8, summary: 'Voss surrenders.' },
				],
			},
		],
		characterProfiles: [
			{ characterName: 'Elena', state: 'Determined', goal: 'Escape', relationships: 'Allied with hero', voice: 'Quiet' },
			{ characterName: 'Voss', state: 'Desperate', goal: 'Survive', relationships: 'Hostile', voice: 'Gruff' },
		],
		characterProfileLastScene: 5,
		turnOfEvents: null,
		turnOfEventsSceneNumber: null,
		turnOfEventsSceneTitle: null,
	};

	it('includes Last update sub-headers for Scene Summaries and Character Profiles', () => {
		const result = serializeCompressedActSummary(dataWithProfiles);

		expect(result).toContain('Last update: Scene 8');
		expect(result).toContain('Last update: Scene 5');
	});

	it('includes Character Profiles section with profiles', () => {
		const result = serializeCompressedActSummary(dataWithProfiles);

		expect(result).toContain('## Character Profiles');
		expect(result).toContain('### Elena');
		expect(result).toContain('- State: Determined');
		expect(result).toContain('- Goal: Escape');
	});

	it('prunes character scene entries at or before characterProfileLastScene', () => {
		const result = serializeCompressedActSummary(dataWithProfiles);

		// Elena: entries at 1, 3, 5 are pruned; 6 and 8 remain
		expect(result).not.toContain('Scene 1: Elena watches.');
		expect(result).not.toContain('Scene 3: Elena investigates.');
		expect(result).not.toContain('Scene 5: Elena guides the hero.');
		expect(result).toContain('Scene 6: Elena fights.');
		expect(result).toContain('Scene 8: Elena escapes.');

		// Voss: entry at 5 is pruned; 7 and 8 remain
		expect(result).not.toContain('Scene 5: Voss attacks.');
		expect(result).toContain('Scene 7: Voss retreats.');
		expect(result).toContain('Scene 8: Voss surrenders.');
	});

	it('includes characterSummariesSinceSceneLabel sub-header', () => {
		const result = serializeCompressedActSummary(dataWithProfiles);

		expect(result).toContain('Summaries of each character for recent Scenes since Scene 6.');
	});

	it('keeps all scene summaries unpruned', () => {
		const result = serializeCompressedActSummary(dataWithProfiles);

		expect(result).toContain('### Scene 1: The Arrival');
		expect(result).toContain('### Scene 5: The Forest');
		expect(result).toContain('### Scene 8: The Castle');
	});

	it('roundtrips compressed output through parseActSummary', () => {
		const compressed = serializeCompressedActSummary(dataWithProfiles);
		const reparsed = parseActSummary(compressed);

		expect(reparsed.scenes).toHaveLength(3);
		expect(reparsed.characterProfiles).toHaveLength(2);
		expect(reparsed.characterProfileLastScene).toBe(5);
		// Characters should only have pruned entries
		const elena = reparsed.characters.find((c) => c.characterName === 'Elena');
		expect(elena).toBeDefined();
		expect(elena!.sceneEntries).toHaveLength(2);
	});

	it('falls back to regular serialization when no profiles exist', () => {
		const dataWithoutProfiles: ActSummary = {
			completedScenes: 3,
			scenes: [{ sceneNumber: 1, title: 'Start', location: 'Town', summary: 'Beginning.' }],
			characters: [
				{
					characterName: 'Elena',
					aliases: ['Elena'],
					sceneEntries: [{ sceneNumber: 1, summary: 'Elena appears.' }],
				},
			],
			characterProfiles: [],
			characterProfileLastScene: null,
			turnOfEvents: null,
			turnOfEventsSceneNumber: null,
			turnOfEventsSceneTitle: null,
		};

		const result = serializeCompressedActSummary(dataWithoutProfiles);

		expect(result).not.toContain('Last update:');
		expect(result).not.toContain('## Character Profiles');
		expect(result).toContain('Scene 1: Elena appears.');
	});
});
