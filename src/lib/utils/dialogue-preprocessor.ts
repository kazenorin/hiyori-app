/**
 * Preprocesses content to wrap dialogue (text in double quotes),
 * character names, and inventory items with highlighting spans.
 *
 * HTML protection strategy:
 * 1. Block-level regions are masked as whole units using a state-machine
 *    parser that correctly handles nested elements.
 * 2. Remaining inline HTML tags are masked individually to protect
 *    attribute values like class="..." from dialogue matching.
 *
 * Generated spans (dialogue, character-name) are also masked before
 * subsequent passes to avoid double-wrapping.
 */

const HTML_BLOCK_TAGS = new Set(['div', 'header', 'aside', 'section', 'article', 'main', 'footer', 'nav', 'blockquote', 'pre', 'table']);

const INLINE_TAG_PATTERN = /<[^>]+>/g;

const DIALOGUE_PATTERN = /"([^"\\]|\\.)*"/g;

const PLACEHOLDER_PREFIX = '\x00DIALOGUE_MASK_';
const PLACEHOLDER_SUFFIX = '\x00';

/**
 * Mask block-level HTML regions using a nesting-aware state machine.
 * Correctly handles nested block elements like <div><div>nested</div>text</div>.
 */
function maskBlockRegions(content: string, maskFn: (text: string) => string): string {
	const result: string[] = [];
	let i = 0;
	const len = content.length;

	while (i < len) {
		if (content[i] === '<') {
			const tagEnd = content.indexOf('>', i);
			if (tagEnd === -1) {
				result.push(content.slice(i));
				break;
			}

			const tag = content.slice(i, tagEnd + 1);
			const tagNameMatch = tag.match(/^<\/?(\w+)/);

			if (tagNameMatch && HTML_BLOCK_TAGS.has(tagNameMatch[1].toLowerCase())) {
				// Found a block-level opening tag — capture the entire region
				const tagName = tagNameMatch[1].toLowerCase();
				const region = extractBlockRegion(content, i, tagName);
				if (region) {
					result.push(maskFn(content.slice(region.start, region.end)));
					i = region.end;
					continue;
				}
			}

			result.push(tag);
			i = tagEnd + 1;
		} else {
			result.push(content[i]);
			i++;
		}
	}

	return result.join('');
}

/**
 * Extract a block-level region starting at position `start` with tag `tagName`.
 * Tracks nesting depth to correctly match the closing tag.
 */
function extractBlockRegion(content: string, start: number, tagName: string): { start: number; end: number } | null {
	let depth = 0;
	let i = start;
	const len = content.length;
	const openRe = new RegExp(`^<${tagName}(?:\\s|>)`, 'i');
	const closeRe = new RegExp(`^<\\/${tagName}\\s*>`, 'i');

	while (i < len) {
		if (content[i] === '<') {
			const rest = content.slice(i);
			if (openRe.test(rest)) {
				depth++;
				const gt = content.indexOf('>', i);
				if (gt === -1) return null;
				i = gt + 1;
				continue;
			}
			if (closeRe.test(rest)) {
				depth--;
				const gt = content.indexOf('>', i);
				if (gt === -1) return null;
				i = gt + 1;
				if (depth === 0) {
					return { start, end: i };
				}
				continue;
			}
			// Some other tag — skip it
			const gt = content.indexOf('>', i);
			if (gt === -1) return null;
			i = gt + 1;
			continue;
		}
		i++;
	}

	// Unmatched block tag — return null, don't mask
	return null;
}

function highlightTerms(text: string, names: string[], spanClass: string, maskAfter?: (text: string) => string): string {
	if (names.length === 0) return text;

	const sorted = [...names].sort((a, b) => b.length - a.length);
	const pattern = new RegExp(`\\b(${sorted.map((n) => escapeRegex(n)).join('|')})\\b`, 'g');
	let result = text.replace(pattern, (match) => `<span class="${spanClass}">${match}</span>`);

	if (maskAfter) {
		result = result.replace(new RegExp(`<span class="${spanClass}">[^<]*<\\/span>`, 'g'), (match) => maskAfter(match));
	}

	return result;
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

	// Step 1: Mask HTML block regions (nesting-aware, protects content inside them)
	let result = maskBlockRegions(content, mask);

	// Step 2: Mask remaining inline HTML tags (protects attribute values like class="...")
	result = result.replace(INLINE_TAG_PATTERN, (match) => mask(match));

	// Step 3: Wrap dialogue quotes in prose
	result = result.replace(DIALOGUE_PATTERN, (match) => {
		return `<span class="dialogue">${match}</span>`;
	});

	// Step 4: Mask dialogue spans so subsequent passes don't match inside them
	result = result.replace(/<span class="dialogue">[^<]*<\/span>/g, (match) => mask(match));

	// Step 5: Wrap character names (mask afterward so inventory pass can't match inside them)
	result = highlightTerms(result, characterNames, 'character-name', mask);

	// Step 6: Wrap inventory items
	result = highlightTerms(result, inventoryNames, 'inventory-item');

	// Step 7: Restore all masks
	return unmask(result);
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
