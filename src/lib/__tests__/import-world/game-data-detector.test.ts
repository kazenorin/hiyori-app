import { describe, it, expect } from 'vitest';
import { extractGameDataTraditional } from '$lib/import-world/game-data-detector';

describe('extractGameDataTraditional', () => {
	it('extracts decisions from "## Decisions" header with list items', () => {
		const content = `Some narrative text here.

## Decisions

What will you do?

* Fight the dragon
* Run away
* Negotiate
* Hide`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions).toHaveLength(4);
		expect(result!.decisions[0]).toBe('Fight the dragon');
		expect(result!.worldState).toBe('What will you do?');
	});

	it('extracts from "## Choices" header', () => {
		const content = `### Choices

* Option A
* Option B`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions).toHaveLength(2);
	});

	it('extracts from "## Options" header', () => {
		const content = `## Options

- First option
- Second option
- Third option`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions).toHaveLength(3);
	});

	it('extracts from "## Decision Point" header', () => {
		const content = `## Decision Point

You must choose:

1. Go left
2. Go right
3. Go straight`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions).toHaveLength(3);
	});

	it('matches "what ... do?" pattern in header', () => {
		const content = `## What will you do?

The situation is dire.

* Surrender
* Fight back`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions).toHaveLength(2);
	});

	it('returns null when fewer than 2 decisions', () => {
		const content = `## Decisions

* Only one option`;

		const result = extractGameDataTraditional(content);
		expect(result).toBeNull();
	});

	it('returns null when no decision headers found', () => {
		const content = `## Story

The hero walked into the forest.

### Scene 2

Nothing happened.`;

		const result = extractGameDataTraditional(content);
		expect(result).toBeNull();
	});

	it('returns null for empty content', () => {
		expect(extractGameDataTraditional('')).toBeNull();
	});

	it('returns null for content without headers', () => {
		expect(extractGameDataTraditional('Just plain text here.')).toBeNull();
	});

	it('extracts worldState from text between header and list items', () => {
		const content = `## Decisions

The dragon approaches from the north.

* Attack
* Defend
* Flee`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.worldState).toBe('The dragon approaches from the north.');
	});

	it('sets worldState to empty string when no text between header and list', () => {
		const content = `## Choices

* Option 1
* Option 2`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.worldState).toBe('');
	});

	it('strips bold markers from decision text', () => {
		const content = `## Decisions

* **Attack the dragon**
* **Run away**
* **Hide in the cave**`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions[0]).toBe('Attack the dragon');
	});

	it('strips italic markers from decision text', () => {
		const content = `## Decisions

* *Sneak past*
* *Create a distraction*
* *Wait and observe*`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions[0]).toBe('Sneak past');
	});

	it('strips inline code markers from decision text', () => {
		const content = `## Choices

* \`use spell\`
* \`draw sword\`
* \`cast barrier\``;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions[0]).toBe('use spell');
	});

	it('handles mixed numbered and bullet lists in different sections', () => {
		const content = `## Narrative

Some story text.

## Decisions

Choose wisely:

1. Fight
2. Flight
3. Hide`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions).toEqual(['Fight', 'Flight', 'Hide']);
	});

	it('uses first matching section with 2+ decisions', () => {
		const content = `## Decisions

* Choice A
* Choice B

## More Decisions

* Choice X
* Choice Y
* Choice Z`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions).toHaveLength(2);
		expect(result!.decisions[0]).toBe('Choice A');
	});

	it('handles # h1 headers', () => {
		const content = `# DECISION POINT

* Fight
* Flee`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions).toHaveLength(2);
	});

	it('handles #### h4 headers', () => {
		const content = `#### Choices available

* Option 1
* Option 2`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
	});

	it('skips empty list items', () => {
		const content = `## Decisions

*
* Fight
*
* Flee`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions).toEqual(['Fight', 'Flee']);
	});
});
