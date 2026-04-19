import { describe, it, expect } from 'vitest';
import { parseMemoryExtract } from '$lib/memory/memory-extract-parser';

describe('parseMemoryExtract', () => {
	it('parses valid markdown with characters, locations, and memories', () => {
		const markdown = `
Some intro text that should be ignored.

## Elena Shadowcrest

### The Tavern at Midnight

- Elena Shadowcrest thought that the stranger was lying about his identity.
- Elena Shadowcrest said to Barkeep: "I need information about the ruins."

### The Forest Path

- Elena Shadowcrest followed the trail deeper into the woods.

## Marcus Thorne

### The Tavern at Midnight

- Marcus Thorne entered the tavern carrying a sealed letter.
- Marcus Thorne said to Elena Shadowcrest: "We need to talk privately."
`;

		const result = parseMemoryExtract(markdown);

		expect(Object.keys(result)).toHaveLength(2);
		expect(result['elena-shadowcrest']).toBeDefined();
		expect(result['marcus-thorne']).toBeDefined();

		expect(Object.keys(result['elena-shadowcrest'])).toHaveLength(2);
		expect(result['elena-shadowcrest']['The Tavern at Midnight']).toHaveLength(2);
		expect(result['elena-shadowcrest']['The Forest Path']).toHaveLength(1);

		expect(result['marcus-thorne']['The Tavern at Midnight']).toHaveLength(2);
	});

	it('converts H2 headings to kebab-case canonical names', () => {
		const markdown = `
## Sir Lancelot du Lac

### Camelot Castle

- Sir Lancelot du Lac drew his sword.
`;

		const result = parseMemoryExtract(markdown);

		expect(result['sir-lancelot-du-lac']).toBeDefined();
		expect(result['sir-lancelot-du-lac']['Camelot Castle']).toEqual(['Sir Lancelot du Lac drew his sword.']);
	});

	it('handles empty markdown', () => {
		const result = parseMemoryExtract('');
		expect(Object.keys(result)).toHaveLength(0);
	});

	it('handles markdown with no H2 headings', () => {
		const markdown = `
### Some Location

- A memory item.
`;

		const result = parseMemoryExtract(markdown);
		expect(Object.keys(result)).toHaveLength(0);
	});

	it('ignores list items not under an H3', () => {
		const markdown = `
## Elena Shadowcrest

- This item is not under an H3, so it should be ignored.

### The Tavern

- This item should be captured.
`;

		const result = parseMemoryExtract(markdown);

		expect(result['elena-shadowcrest']['The Tavern']).toEqual(['This item should be captured.']);
		// No key for items outside H3
		expect(Object.keys(result['elena-shadowcrest'])).toHaveLength(1);
	});

	it('handles H3 before any H2 gracefully', () => {
		const markdown = `
### Orphan Location

- This should be ignored since there's no parent H2.

## Elena Shadowcrest

### The Tavern

- Elena Shadowcrest sat by the fire.
`;

		const result = parseMemoryExtract(markdown);

		expect(Object.keys(result)).toHaveLength(1);
		expect(result['elena-shadowcrest']['The Tavern']).toEqual(['Elena Shadowcrest sat by the fire.']);
	});

	it('handles multiple characters with same location name', () => {
		const markdown = `
## Elena Shadowcrest

### The Market

- Elena bought herbs.

## Marcus Thorne

### The Market

- Marcus sold his horse.
`;

		const result = parseMemoryExtract(markdown);

		expect(result['elena-shadowcrest']['The Market']).toEqual(['Elena bought herbs.']);
		expect(result['marcus-thorne']['The Market']).toEqual(['Marcus sold his horse.']);
	});

	it('handles character with multiple memories in one location', () => {
		const markdown = `
## Elena

### Castle

- Memory one.
- Memory two.
- Memory three.
`;

		const result = parseMemoryExtract(markdown);

		expect(result['elena']['Castle']).toHaveLength(3);
		expect(result['elena']['Castle'][0]).toBe('Memory one.');
		expect(result['elena']['Castle'][2]).toBe('Memory three.');
	});

	it('handles scratchpad blocks before the memory output', () => {
		const markdown = `
<scratchpad>
Some analysis text here.
Character: Elena - important, named.
</scratchpad>

## Elena

### The Tower

- Elena climbed the tower stairs.
`;

		const result = parseMemoryExtract(markdown);

		expect(result['elena']['The Tower']).toEqual(['Elena climbed the tower stairs.']);
	});

	it('handles H2 with special characters in name', () => {
		const markdown = `
## O'Brien the Elder

### Village Square

- O'Brien addressed the crowd.
`;

		const result = parseMemoryExtract(markdown);

		// toKebabCase lowercases and replaces special chars (apostrophe becomes hyphen)
		expect(result['o-brien-the-elder']).toBeDefined();
	});

	it('handles character with no memories under location', () => {
		const markdown = `
## Elena

### Empty Location

## Marcus

### Castle

- Marcus stood guard.
`;

		const result = parseMemoryExtract(markdown);

		expect(result['elena']['Empty Location']).toEqual([]);
		expect(result['marcus']['Castle']).toEqual(['Marcus stood guard.']);
	});
});
