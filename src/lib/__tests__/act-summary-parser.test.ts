import { describe, it, expect } from 'vitest';
import {
	parseActSummary,
	serializeActSummary,
	parseIncrementalOutput,
	mergeActSummary,
	type ActSummary,
	type IncrementalUpdate,
} from '../ai/act-summary-parser';

const SAMPLE_ACT_SUMMARY = `# Act Summary

## Progress
- Completed scenes: 2

## Scene Summaries
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

		expect(result.completedScenes).toBe(2);
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

	it('parses act summary with missing progress section', () => {
		const markdown = `## Scene Summaries
### Scene 1: Test
Location: Somewhere
Summary: Something happened.

## Character Summaries
### Bob
- Aliases: [Bobby]
- Scene 1: Bob did a thing.`;

		const result = parseActSummary(markdown);
		expect(result.completedScenes).toBe(0);
		expect(result.scenes).toHaveLength(1);
		expect(result.characters).toHaveLength(1);
	});

	it('parses act summary with missing scene summaries section', () => {
		const markdown = `## Progress
- Completed scenes: 1

## Character Summaries
### Alice
- Aliases: [Ali]
- Scene 1: Alice appeared.`;

		const result = parseActSummary(markdown);
		expect(result.completedScenes).toBe(1);
		expect(result.scenes).toHaveLength(0);
		expect(result.characters).toHaveLength(1);
	});

	it('parses act summary with missing character summaries section', () => {
		const markdown = `## Progress
- Completed scenes: 3

## Scene Summaries
### Scene 1: Beginning
Location: Start
Summary: The start.`;

		const result = parseActSummary(markdown);
		expect(result.completedScenes).toBe(3);
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
		};

		const result = serializeActSummary(data);

		expect(result).toContain('# Act Summary');
		expect(result).toContain('## Progress');
		expect(result).toContain('- Completed scenes: 2');
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
		};

		const result = serializeActSummary(data);
		expect(result).toContain('# Act Summary');
		expect(result).toContain('- Completed scenes: 0');
		expect(result).toContain('## Scene Summaries');
		expect(result).toContain('## Character Summaries');
	});

	it('roundtrips: parse → serialize → parse produces identical data', () => {
		const original = parseActSummary(SAMPLE_ACT_SUMMARY);
		const serialized = serializeActSummary(original);
		const reparsed = parseActSummary(serialized);

		expect(reparsed.completedScenes).toBe(original.completedScenes);
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
});

describe('parseIncrementalOutput', () => {
	it('parses an incremental update with a new scene and character updates', () => {
		const markdown = `## Progress
- Completed scenes: 3

## Scene Summaries
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

		expect(result.completedScenes).toBe(3);
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
			completedScenes: 1,
			scenes: [{ sceneNumber: 1, title: 'Start', location: 'Town', summary: 'Beginning.' }],
			characters: [
				{
					characterName: 'Elena',
					aliases: ['Elena'],
					sceneEntries: [{ sceneNumber: 1, summary: 'Elena appears.' }],
				},
			],
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
			completedScenes: 1,
			scenes: [{ sceneNumber: 1, title: 'Start', location: 'Town', summary: 'Beginning.' }],
			characters: [
				{
					characterName: 'Elena',
					aliases: ['Elena'],
					sceneEntries: [{ sceneNumber: 1, summary: 'Elena appears.' }],
				},
			],
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

		const incrementalMarkdown = `## Progress
- Completed scenes: 3

## Scene Summaries
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

		expect(merged.completedScenes).toBe(3);
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
		expect(reparsed.completedScenes).toBe(3);
		expect(reparsed.scenes).toHaveLength(3);
		expect(reparsed.characters).toHaveLength(3);
	});
});
