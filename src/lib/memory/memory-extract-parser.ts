import { marked, type Tokens } from 'marked';
import { toKebabCase } from '$lib/utils/string';

export type ExtractedMemories = {
	[characterCanonicalName: string]: {
		[location: string]: string[];
	};
};

/**
 * Parse a markdown file into a structured memory extract.
 *
 * Skips everything before the first H2 heading.
 * H2 text is converted to kebab-case canonical name.
 * Structure: { "kebab-case-name": { "H3 text": ["item1", "item2", ...] } }
 */
export function parseMemoryExtract(markdown: string): ExtractedMemories {
	const tokens = marked.lexer(markdown);
	const result: ExtractedMemories = {};

	let currentH2: string | null = null;
	let currentH3: string | null = null;

	for (const token of tokens) {
		if (token.type === 'heading') {
			const heading = token as Tokens.Heading;
			if (heading.depth === 2) {
				currentH2 = toKebabCase(heading.text);
				currentH3 = null;
				if (!result[currentH2]) {
					result[currentH2] = {};
				}
			} else if (heading.depth === 3 && currentH2 !== null) {
				currentH3 = heading.text;
				if (!result[currentH2][currentH3]) {
					result[currentH2][currentH3] = [];
				}
			}
		} else if (token.type === 'list' && currentH2 !== null && currentH3 !== null) {
			const list = token as Tokens.List;
			for (const item of list.items) {
				result[currentH2][currentH3].push(item.text);
			}
		}
	}

	return result;
}
