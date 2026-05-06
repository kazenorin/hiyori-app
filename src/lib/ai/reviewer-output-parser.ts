import { marked, type Tokens } from 'marked';

/**
 * Parse reviewer output and determine whether the Editor phase can be skipped.
 *
 * The reviewer is instructed to produce markdown with a `## Summary` section
 * containing `- Total violations: N` and `- Recommendation: accept as-is`.
 * We structurally verify both markers (case-insensitive) rather than doing
 * a fragile substring match on raw text.
 */
/**
 * Strip code block fences wrapping the markdown.
 * LLMs sometimes wrap output in ``` or ```lang ... ``` blocks.
 */
function stripCodeFences(text: string): string {
	return text.replace(/^```[^\n]*\n/, '').replace(/\n```[\s]*$/, '');
}

export function reviewerAcceptsAsIs(reviewerOutput: string | undefined): boolean {
	if (!reviewerOutput) return false;

	let inSummary = false;
	let violationsZero = false;
	let recommendationAccept = false;

	const tokens = marked.lexer(stripCodeFences(reviewerOutput));

	for (const token of tokens) {
		if (token.type === 'heading') {
			const heading = token as Tokens.Heading;
			inSummary = heading.depth === 2 && heading.text.toLowerCase().trim() === 'summary';
			continue;
		}

		if (token.type === 'list' && inSummary) {
			const list = token as Tokens.List;
			for (const item of list.items) {
				const text = item.text.toLowerCase();
				if (/^total\s+violations:\s*0\b/.test(text.trim())) {
					violationsZero = true;
				}
				if (/^recommendation:\s*accept\s+as-is\b/.test(text.trim())) {
					recommendationAccept = true;
				}
			}
			continue;
		}

		// Paragraphs inside summary section (LLMs sometimes flatten list items)
		if (token.type === 'paragraph' && inSummary) {
			const text = (token as Tokens.Paragraph).text.toLowerCase();
			if (/total\s+violations:\s*0\b/.test(text)) {
				violationsZero = true;
			}
			if (/recommendation:\s*accept\s+as-is\b/.test(text)) {
				recommendationAccept = true;
			}
		}
	}

	return violationsZero && recommendationAccept;
}
