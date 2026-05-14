import { describe, it, expect } from 'vitest';
import { parseMemoryExtract } from '$lib/features/memory/memory-extract-parser';

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

		expect(Object.keys(result['elena-shadowcrest'].locations)).toHaveLength(2);
		expect(result['elena-shadowcrest'].locations['The Tavern at Midnight']).toHaveLength(2);
		expect(result['elena-shadowcrest'].locations['The Forest Path']).toHaveLength(1);

		expect(result['marcus-thorne'].locations['The Tavern at Midnight']).toHaveLength(2);
	});

	it('converts H2 headings to kebab-case canonical names', () => {
		const markdown = `
## Sir Lancelot du Lac

### Camelot Castle

- Sir Lancelot du Lac drew his sword.
`;

		const result = parseMemoryExtract(markdown);
		expect(result['sir-lancelot-du-lac']).toBeDefined();
		expect(result['sir-lancelot-du-lac'].locations['Camelot Castle']).toEqual(['Sir Lancelot du Lac drew his sword.']);
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
		expect(result['elena-shadowcrest'].locations['The Tavern']).toEqual(['This item should be captured.']);
		// No key for items outside H3
		expect(Object.keys(result['elena-shadowcrest'].locations)).toHaveLength(1);
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
		expect(result['elena-shadowcrest'].locations['The Tavern']).toEqual(['Elena Shadowcrest sat by the fire.']);
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
		expect(result['elena-shadowcrest'].locations['The Market']).toEqual(['Elena bought herbs.']);
		expect(result['marcus-thorne'].locations['The Market']).toEqual(['Marcus sold his horse.']);
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
		expect(result['elena'].locations['Castle']).toHaveLength(3);
		expect(result['elena'].locations['Castle'][0]).toBe('Memory one.');
		expect(result['elena'].locations['Castle'][2]).toBe('Memory three.');
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
		expect(result['elena'].locations['The Tower']).toEqual(['Elena climbed the tower stairs.']);
	});

	it('handles H2 with special characters in name', () => {
		const markdown = `
## O'Brien the Elder

### Village Square

- O'Brien addressed the crowd.
`;

		const result = parseMemoryExtract(markdown);
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
		expect(result['elena'].locations['Empty Location']).toEqual([]);
		expect(result['marcus'].locations['Castle']).toEqual(['Marcus stood guard.']);
	});

	it('parses inventory items under #### Inventory heading', () => {
		const markdown = `
## elena-shadowcrest

### The Tavern

- Elena drew her sword.

#### Inventory

- **item**: Iron Sword - A battered blade [carried]
- **equipment**: Leather Armor - Worn and patched [equipped]
- **clothing**: Travel Cloak - Dark green [equipped]
- **skill**: Basic Swordsmanship - Trained [known]
- **status**: Mildly Wounded - Cut on left arm [known]
`;

		const result = parseMemoryExtract(markdown);
		const elena = result['elena-shadowcrest'];
		expect(elena).toBeDefined();
		expect(elena.locations['The Tavern']).toEqual(['Elena drew her sword.']);
		expect(elena.inventory).toBeDefined();
		expect(elena.inventory!.items).toHaveLength(5);
		expect(elena.inventory!.items[0]).toEqual({
			name: 'Iron Sword',
			category: 'item',
			equipStatus: 'carried',
			description: 'A battered blade',
		});
		expect(elena.inventory!.items[1]).toEqual({
			name: 'Leather Armor',
			category: 'equipment',
			equipStatus: 'equipped',
			description: 'Worn and patched',
		});
		expect(elena.inventory!.items[3]).toEqual({
			name: 'Basic Swordsmanship',
			category: 'skill',
			equipStatus: 'known',
			description: 'Trained',
		});
	});

	it('parses inventory items without description', () => {
		const markdown = `
## marcus-thorne

### The Market

- Marcus bought supplies.

#### Inventory

- **item**: Healing Potion (x2) [carried]
- **equipment**: Iron Shield [equipped]
`;

		const result = parseMemoryExtract(markdown);
		const marcus = result['marcus-thorne'];
		expect(marcus.inventory).toBeDefined();
		expect(marcus.inventory!.items).toHaveLength(2);
		expect(marcus.inventory!.items[0]).toEqual({
			name: 'Healing Potion (x2)',
			category: 'item',
			equipStatus: 'carried',
			description: undefined,
		});
		expect(marcus.inventory!.items[1]).toEqual({
			name: 'Iron Shield',
			category: 'equipment',
			equipStatus: 'equipped',
			description: undefined,
		});
	});

	it('defaults equip_status to carried when not specified', () => {
		const markdown = `
## elena

### The Tower

- Elena looked out the window.

#### Inventory

- **item**: Rusty Key
`;

		const result = parseMemoryExtract(markdown);
		const elena = result['elena'];
		expect(elena.inventory).toBeDefined();
		expect(elena.inventory!.items).toHaveLength(1);
		expect(elena.inventory!.items[0].equipStatus).toBe('carried');
	});

	it('ignores invalid inventory categories', () => {
		const markdown = `
## elena

### The Tavern

- Elena sat down.

#### Inventory

- **weapon**: Magic Staff - A powerful staff [equipped]
- **item**: Health Potion - Restores health [carried]
`;

		const result = parseMemoryExtract(markdown);
		const elena = result['elena'];
		expect(elena.inventory).toBeDefined();
		// 'weapon' is not a valid category, only 'item' should be parsed
		expect(elena.inventory!.items).toHaveLength(1);
		expect(elena.inventory!.items[0].name).toBe('Health Potion');
	});

	it('handles character with inventory but no location memories', () => {
		const markdown = `
## elena

#### Inventory

- **item**: Iron Sword [carried]
`;

		const result = parseMemoryExtract(markdown);
		const elena = result['elena'];
		expect(elena.inventory).toBeDefined();
		expect(elena.inventory!.items).toHaveLength(1);
		expect(Object.keys(elena.locations)).toHaveLength(0);
	});

	it('handles character without inventory section', () => {
		const markdown = `
## elena

### The Tavern

- Elena sat by the fire.
`;

		const result = parseMemoryExtract(markdown);
		const elena = result['elena'];
		expect(elena.inventory).toBeUndefined();
		expect(elena.locations['The Tavern']).toEqual(['Elena sat by the fire.']);
	});

		it('parses inventory changes under #### Inventory Changes heading', () => {
			const markdown = `
## elena-shadowcrest

### The Ruins

- Elena explored the ancient chamber.

#### Inventory

- **item**: Iron Sword - A battered blade [carried]

#### Inventory Changes

- **acquired**: Ancient Amulet - Found in the stone pedestal
- **lost**: Wooden Shield - Shattered by the golem
- **equipped**: Iron Sword - Drew from its scabbard
`;

			const result = parseMemoryExtract(markdown);
			const elena = result['elena-shadowcrest'];
			expect(elena.inventory).toBeDefined();
			expect(elena.inventory!.items).toHaveLength(1);
			expect(elena.inventory!.changes).toBeDefined();
			expect(elena.inventory!.changes!).toHaveLength(3);
			expect(elena.inventory!.changes![0]).toEqual({
				itemName: 'Ancient Amulet',
				changeType: 'acquired',
				description: 'Found in the stone pedestal',
			});
			expect(elena.inventory!.changes![1]).toEqual({
				itemName: 'Wooden Shield',
				changeType: 'lost',
				description: 'Shattered by the golem',
			});
			expect(elena.inventory!.changes![2]).toEqual({
				itemName: 'Iron Sword',
				changeType: 'equipped',
				description: 'Drew from its scabbard',
			});
		});

		it('parses inventory changes without description', () => {
			const markdown = `
## marcus-thorne

### The Market

- Marcus bought supplies.

#### Inventory Changes

- **acquired**: Healing Potion
- **used**: Healing Potion
`;

			const result = parseMemoryExtract(markdown);
			const marcus = result['marcus-thorne'];
			expect(marcus.inventory).toBeDefined();
			expect(marcus.inventory!.changes).toHaveLength(2);
			expect(marcus.inventory!.changes![0]).toEqual({
				itemName: 'Healing Potion',
				changeType: 'acquired',
				description: undefined,
			});
			expect(marcus.inventory!.changes![1]).toEqual({
				itemName: 'Healing Potion',
				changeType: 'used',
				description: undefined,
			});
		});

		it('ignores invalid change types in inventory changes', () => {
			const markdown = `
## elena

### The Tower

- Elena climbed the stairs.

#### Inventory Changes

- **found**: Magic Key - Hidden under a brick
- **acquired**: Health Potion - Received from the healer
`;

			const result = parseMemoryExtract(markdown);
			const elena = result['elena'];
			expect(elena.inventory!.changes).toHaveLength(1);
			expect(elena.inventory!.changes![0].changeType).toBe('acquired');
		});

		it('handles inventory changes without inventory section', () => {
			const markdown = `
## elena

### The Cave

- Elena entered the cave.

#### Inventory Changes

- **acquired**: Torch - Lit from the entrance brazier
`;

			const result = parseMemoryExtract(markdown);
			const elena = result['elena'];
			expect(elena.inventory).toBeDefined();
			expect(elena.inventory!.items).toHaveLength(0);
			expect(elena.inventory!.changes).toHaveLength(1);
		});

		it('handles character without inventory changes section', () => {
			const markdown = `
## elena

### The Tavern

- Elena sat by the fire.

#### Inventory

- **item**: Iron Sword [carried]
`;

			const result = parseMemoryExtract(markdown);
			const elena = result['elena'];
			expect(elena.inventory).toBeDefined();
			expect(elena.inventory!.items).toHaveLength(1);
			expect(elena.inventory!.changes).toBeUndefined();
		});

		it('parses all six change types', () => {
			const markdown = `
## elena

### The Armory

- Elena rummaged through the supplies.

#### Inventory Changes

- **acquired**: Steel Dagger - Taken from the weapon rack
- **lost**: Map - Blown away by the wind
- **equipped**: Chain Mail - Put on before the patrol
- **unequipped**: Travel Cloak - Removed to move quietly
- **used**: Scroll of Fire - Cast against the enemies
- **modified**: Enchanted Ring - Absorbed a new enchantment
`;

			const result = parseMemoryExtract(markdown);
			const elena = result['elena'];
			expect(elena.inventory!.changes).toHaveLength(6);
			const types = elena.inventory!.changes!.map((c) => c.changeType);
			expect(types).toEqual(['acquired', 'lost', 'equipped', 'unequipped', 'used', 'modified']);
		});
});
