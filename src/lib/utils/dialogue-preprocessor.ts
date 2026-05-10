/**
 * Preprocesses content to wrap dialogue (text in double quotes),
 * character names, and inventory items with highlighting spans.
 *
 * Two layers of HTML protection:
 * 1. Block-level elements (div, header, aside, etc.) — entire regions
 *    masked to protect both attributes and content inside them.
 * 2. Inline HTML tags (<span>, <br/>, etc.) — individual tags masked
 *    to protect attribute values like class="..." from dialogue matching.
 *
 * Generated spans (dialogue, character-name) are also masked before
 * subsequent passes to avoid double-wrapping.
 */

const HTML_BLOCK_TAGS = ['div', 'header', 'aside', 'section', 'article', 'main', 'footer', 'nav', 'blockquote', 'pre', 'table'] as const;

const HTML_BLOCK_PATTERN = new RegExp(
	`<(?:${HTML_BLOCK_TAGS.join('|')})(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:${HTML_BLOCK_TAGS.join('|')})>`,
	'gi'
);

const INLINE_TAG_PATTERN = /<[^>]+>/g;

const DIALOGUE_PATTERN = /"([^"\\]|\\.)*"/g;

const PLACEHOLDER_PREFIX = '\x00DIALOGUE_MASK_';
const PLACEHOLDER_SUFFIX = '\x00';

export interface PreprocessOptions {
	characterNames?: string[];
	inventoryNames?: string[];
}

export function preprocessDialogue(content: string, characterNames: string[] = [], inventoryNames: string[] = []): string {
	const masks: string[] = [];

	function mask(text: string): string {
		const index = masks.length;
		masks.push(text);
		return `${PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`;
	}

	function unmask(text: string): string {
		return text.replace(
			new RegExp(`${escapeRegex(PLACEHOLDER_PREFIX)}(\\d+)${escapeRegex(PLACEHOLDER_SUFFIX)}`, 'g'),
			(_, index) => masks[parseInt(index)]
		);
	}

	// Step 1: Mask HTML block regions (protects content inside them)
	let result = content.replace(HTML_BLOCK_PATTERN, (match) => mask(match));

	// Step 2: Mask remaining inline HTML tags (protects attribute values like class="...")
	result = result.replace(INLINE_TAG_PATTERN, (match) => mask(match));

	// Step 3: Wrap dialogue quotes in prose
	result = result.replace(DIALOGUE_PATTERN, (match) => {
		return `<span class="dialogue">${match}</span>`;
	});

	// Step 4: Mask dialogue spans so subsequent passes don't match inside them
	result = result.replace(/<span class="dialogue">[^<]*<\/span>/g, (match) => mask(match));

	// Step 5: Wrap character names (longest first to avoid partial matches)
	if (characterNames.length > 0) {
		const sorted = [...characterNames].sort((a, b) => b.length - a.length);
		const namePattern = new RegExp(`\\b(${sorted.map((n) => escapeRegex(n)).join('|')})\\b`, 'g');
		result = result.replace(namePattern, (match) => `<span class="character-name">${match}</span>`);

		// Mask character-name spans so inventory pass doesn't match inside them
		result = result.replace(/<span class="character-name">[^<]*<\/span>/g, (match) => mask(match));
	}

	// Step 6: Wrap inventory items (longest first to avoid partial matches)
	if (inventoryNames.length > 0) {
		const sorted = [...inventoryNames].sort((a, b) => b.length - a.length);
		const itemPattern = new RegExp(`\\b(${sorted.map((n) => escapeRegex(n)).join('|')})\\b`, 'g');
		result = result.replace(itemPattern, (match) => `<span class="inventory-item">${match}</span>`);
	}

	// Step 7: Restore all masks
	return unmask(result);
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
