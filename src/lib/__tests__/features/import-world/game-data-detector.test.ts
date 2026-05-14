import { describe, it, expect } from 'vitest';
import { extractGameDataTraditional } from '../../../features/import-world/game-data-detector';

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
		expect(result!.decisionContext).toBe('What will you do?');
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

	it('extracts decisionContext from text between header and list items', () => {
		const content = `## Decisions

The dragon approaches from the north.

* Attack
* Defend
* Flee`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisionContext).toBe('The dragon approaches from the north.');
	});

	it('sets decisionContext to null when no text between header and list', () => {
		const content = `## Choices

* Option 1
* Option 2`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisionContext).toBeNull();
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

	// === Bold bracket marker patterns ===

	it('extracts from **[DECISION POINT]** bold bracket marker', () => {
		const content = `Some story narrative here.

**[DECISION POINT]**

It's getting late, what should you do?

> 1. Go to bed.
> 2. Just one more turn.
> 3. Call a friend.
> 4. Procrastinate.
> 5. *(Free choice - describe what you will do)*`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions).toHaveLength(5);
		expect(result!.decisions[0]).toBe('Go to bed.');
		expect(result!.decisions[4]).toBe('Free choice - describe what you will do');
		expect(result!.decisionContext).toBe("It's getting late, what should you do?");
	});

	it('extracts from **[CHOICES]** bold bracket marker', () => {
		const content = `The guard blocks the path.

**[CHOICES]**

What do you do?

> * Bribe the guard
> * Find another way
> * Fight through`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions).toHaveLength(3);
		expect(result!.decisions[0]).toBe('Bribe the guard');
		expect(result!.decisionContext).toBe('What do you do?');
	});

	it('extracts from **[OPTIONS]** bold bracket marker with plain numbered list', () => {
		const content = `**[OPTIONS]**

Pick your path:

1. Left corridor
2. Right corridor
3. Stairway`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions).toHaveLength(3);
		expect(result!.decisions).toEqual(['Left corridor', 'Right corridor', 'Stairway']);
	});

	it('extracts from **[DECISION]** marker with blockquote bullet list', () => {
		const content = `The room is silent.

**[DECISION]**

> - Open the door quietly
> - Knock and announce yourself
> - Wait and listen`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions).toHaveLength(3);
		expect(result!.decisionContext).toBeNull();
	});

	// === Blockquote list item patterns ===

	it('handles blockquote numbered list with markdown headers', () => {
		const content = `## Decisions

The bridge is collapsing!

> 1. Sprint across
> 2. Jump to the ledge
> 3. Hang and climb down`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions).toHaveLength(3);
		expect(result!.decisionContext).toBe('The bridge is collapsing!');
	});

	it('handles blockquote bullet list with markdown headers', () => {
		const content = `### Choices

> * Cast fireball
> * Heal ally
> * Retreat`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions).toHaveLength(3);
	});

	it('handles mixed blockquote and plain list items', () => {
		const content = `## Options

Choose wisely:

> 1. Accept the quest
2. Decline politely
> 3. Ask for more details`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions).toHaveLength(3);
	});

	it('handles parenthesized numbered list in blockquote', () => {
		const content = `**[DECISION POINT]**

What now?

> 1) Run
> 2) Hide
> 3) Fight`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions).toEqual(['Run', 'Hide', 'Fight']);
	});

	it('strips italic from blockquote list items', () => {
		const content = `**[CHOICES]**

> * *Sneak past the guards*
> * *Create a diversion*
> * *Climb the wall*`;

		const result = extractGameDataTraditional(content);
		expect(result).not.toBeNull();
		expect(result!.decisions[0]).toBe('Sneak past the guards');
	});

	it('returns null when bold bracket marker has fewer than 2 decisions', () => {
		const content = `**[DECISION POINT]**

> * Only one choice`;

		const result = extractGameDataTraditional(content);
		expect(result).toBeNull();
	});

	it('returns null when bold bracket has no decision keyword', () => {
		const content = `**[SCENE BREAK]**

> * Continue forward
> * Turn back`;

		const result = extractGameDataTraditional(content);
		expect(result).toBeNull();
	});
});
