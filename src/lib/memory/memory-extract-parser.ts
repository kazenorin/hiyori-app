import { marked, type Tokens } from 'marked';
import { kebabCase } from 'lodash-es';
import {
	INVENTORY_CATEGORIES,
	EQUIP_STATUSES,
	INVENTORY_CHANGE_TYPES,
	type InventoryCategory,
	type EquipStatus,
	type InventoryChange,
	type ExtractedInventory,
	type ExtractedInventoryItem,
	type ExtractedInventoryChange,
} from './inventory-types';

export interface CharacterData {
	locations: { [location: string]: string[] };
	inventory?: ExtractedInventory;
}

export type ExtractedMemories = {
	[characterCanonicalName: string]: CharacterData;
};

const VALID_CATEGORIES = new Set<string>(INVENTORY_CATEGORIES);
const VALID_STATUSES = new Set<string>(EQUIP_STATUSES);

/**
 * Parse a markdown file into a structured memory extract.
 *
 * Skips everything before the first H2 heading.
 * H2 text is converted to kebab-case canonical name.
 * Structure: { "kebab-case-name": { locations: { "H3 text": ["item1", ...] }, inventory?: ExtractedInventory } }
 */
export function parseMemoryExtract(markdown: string): ExtractedMemories {
	const tokens = marked.lexer(markdown);
	const result: ExtractedMemories = {};

	let currentH2: string | null = null;
	let currentH3: string | null = null;
	let inInventorySection = false;
	let inInventoryChangesSection = false;

	for (const token of tokens) {
		if (token.type === 'heading') {
			const heading = token as Tokens.Heading;
			if (heading.depth === 2) {
				currentH2 = kebabCase(heading.text);
				currentH3 = null;
				inInventorySection = false;
				inInventoryChangesSection = false;
				if (!result[currentH2]) {
					result[currentH2] = { locations: {} };
				}
			} else if (heading.depth === 3 && currentH2 !== null) {
				currentH3 = heading.text;
				inInventorySection = false;
				inInventoryChangesSection = false;
				if (!result[currentH2].locations[currentH3]) {
					result[currentH2].locations[currentH3] = [];
				}
			} else if (heading.depth === 4 && currentH2 !== null) {
				const headingText = heading.text.trim().toLowerCase();
				if (headingText === 'inventory') {
					inInventorySection = true;
					inInventoryChangesSection = false;
					if (!result[currentH2].inventory) {
						result[currentH2].inventory = { items: [] };
					}
				} else if (headingText === 'inventory changes') {
					inInventorySection = false;
					inInventoryChangesSection = true;
					if (!result[currentH2].inventory) {
						result[currentH2].inventory = { items: [] };
					}
					if (!result[currentH2].inventory!.changes) {
						result[currentH2].inventory!.changes = [];
					}
				} else {
					inInventorySection = false;
					inInventoryChangesSection = false;
				}
			}
		} else if (token.type === 'list') {
			if (inInventorySection && currentH2 !== null && result[currentH2]?.inventory) {
				const list = token as Tokens.List;
				for (const item of list.items) {
					const parsed = parseInventoryItem(item.text);
					if (parsed) {
						result[currentH2].inventory!.items.push(parsed);
					}
				}
			} else if (inInventoryChangesSection && currentH2 !== null && result[currentH2]?.inventory) {
				const list = token as Tokens.List;
				for (const item of list.items) {
					const parsed = parseInventoryChangeItem(item.text);
					if (parsed) {
						result[currentH2].inventory!.changes!.push(parsed);
					}
				}
			} else if (currentH2 !== null && currentH3 !== null) {
				const list = token as Tokens.List;
				for (const item of list.items) {
					result[currentH2].locations[currentH3].push(item.text);
				}
			}
		}
	}

	return result;
}

/**
 * Parse an inventory item line in the format:
 * **category**: Name - Description [equip_status]
 * or
 * **category**: Name [equip_status]
 *
 * Examples:
 * - **item**: Iron Sword - A battered blade [carried]
 * - **equipment**: Leather Armor [equipped]
 * - **skill**: Basic Swordsmanship - Trained [known]
 * - **item**: Healing Potion (x2) - Restores wounds [carried]
 */
function parseInventoryItem(text: string): ExtractedInventoryItem | null {
	// Match: **category**: Name - Description [equip_status] or **category**: Name [equip_status]
	const match = text.match(/^\*\*(\w+)\*\*:\s+(.+?)$/);
	if (!match) return null;

	const category = match[1].toLowerCase();
	if (!VALID_CATEGORIES.has(category)) return null;

	let rest = match[2].trim();

	// Extract [equip_status] from the end
	let equipStatus: EquipStatus = 'carried'; // default
	const statusRegex = new RegExp(`\\[(${[...VALID_STATUSES].join('|')})\\]\\s*$`);
	const statusMatch = rest.match(statusRegex);
	if (statusMatch) {
		equipStatus = statusMatch[1] as EquipStatus;
		rest = rest.slice(0, rest.length - statusMatch[0].length).trim();
	}

	// Split "Name - Description"
	const dashIndex = rest.indexOf(' - ');
	let name: string;
	let description: string | undefined;

	if (dashIndex !== -1) {
		name = rest.slice(0, dashIndex).trim();
		description = rest.slice(dashIndex + 3).trim() || undefined;
	} else {
		name = rest.trim();
	}

	if (!name) return null;

	return {
		name,
		category: category as InventoryCategory,
		equipStatus,
		description,
	};
}

/**
 * Parse an inventory change line in the format:
 * **change_type**: Item Name - Description
 * or
 * **change_type**: Item Name
 *
 * Examples:
 * - **acquired**: Iron Sword - Picked up from the fallen knight
 * - **lost**: Wooden Shield - Shattered in combat
 * - **equipped**: Leather Armor - Put on before the battle
 * - **used**: Healing Potion - Drank to heal wounds
 */
function parseInventoryChangeItem(text: string): ExtractedInventoryChange | null {
	const match = text.match(/^\*\*(\w+)\*\*:\s+(.+?)$/);
	if (!match) return null;

	const changeType = match[1].toLowerCase();
	if (!INVENTORY_CHANGE_TYPES.includes(changeType as InventoryChange['changeType'])) return null;

	let rest = match[2].trim();

	// Split "Item Name - Description"
	const dashIndex = rest.indexOf(' - ');
	let itemName: string;
	let description: string | undefined;

	if (dashIndex !== -1) {
		itemName = rest.slice(0, dashIndex).trim();
		description = rest.slice(dashIndex + 3).trim() || undefined;
	} else {
		itemName = rest.trim();
	}

	if (!itemName) return null;

	return {
		itemName,
		changeType: changeType as InventoryChange['changeType'],
		description,
	};
}
