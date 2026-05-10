/**
 * Preprocesses content to wrap dialogue (text in double quotes) with
 * `<span class="dialogue">` tags for highlighting.
 *
 * HTML block regions (div, header, aside, etc.) are protected — quotes
 * inside them (including attribute values like class="...") are not modified.
 */

const HTML_BLOCK_TAGS = ['div', 'header', 'aside', 'section', 'article', 'main', 'footer', 'nav', 'blockquote', 'pre', 'table'] as const;

const HTML_BLOCK_PATTERN = new RegExp(
	`<(?:${HTML_BLOCK_TAGS.join('|')})(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:${HTML_BLOCK_TAGS.join('|')})>`,
	'gi'
);

const DIALOGUE_PATTERN = /"([^"\\]|\\.)*"/g;

const PLACEHOLDER_PREFIX = '\x00DIALOGUE_HTML_BLOCK_';
const PLACEHOLDER_SUFFIX = '\x00';

export function preprocessDialogue(content: string): string {
	const htmlBlocks: string[] = [];

	// Mask HTML block regions
	const masked = content.replace(HTML_BLOCK_PATTERN, (match) => {
		const index = htmlBlocks.length;
		htmlBlocks.push(match);
		return `${PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`;
	});

	// Wrap dialogue quotes in prose
	const processed = masked.replace(DIALOGUE_PATTERN, (match) => {
		return `<span class="dialogue">${match}</span>`;
	});

	// Restore HTML blocks
	return processed.replace(
		new RegExp(`${escapeRegex(PLACEHOLDER_PREFIX)}(\\d+)${escapeRegex(PLACEHOLDER_SUFFIX)}`, 'g'),
		(_, index) => htmlBlocks[parseInt(index)]
	);
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
