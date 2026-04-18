import { describe, it, expect } from 'vitest';
import { createXmlTagParser } from '../ai/xml-tag-parser';

function feedAll(chunks: string[], tagName: string): { text: string; extracted: string | null } {
	const parser = createXmlTagParser(tagName);
	let text = '';
	let extracted: string | null = null;

	for (const chunk of chunks) {
		const acc: Record<string, string | null> = { [tagName]: null };
		const result = parser.feed(chunk, acc);
		if (result) text += result;
		if (acc[tagName]) extracted = (extracted ?? '') + acc[tagName];
	}

	const acc: Record<string, string | null> = { [tagName]: null };
	const flushed = parser.flush(acc);
	if (flushed) text += flushed;
	if (acc[tagName]) extracted = (extracted ?? '') + acc[tagName];

	return { text, extracted };
}

describe('XmlTagParser', () => {
	describe('plain text passthrough', () => {
		it('passes plain text through unchanged', () => {
			const { text, extracted } = feedAll(['Hello, world!'], 'review_scratchpad');
			expect(text).toBe('Hello, world!');
			expect(extracted).toBeNull();
		});

		it('passes text with unrelated XML tags through unchanged', () => {
			const { text, extracted } = feedAll(['<other>content</other>'], 'review_scratchpad');
			expect(text).toBe('<other>content</other>');
			expect(extracted).toBeNull();
		});

		it('passes partial tag opener through unchanged', () => {
			const { text, extracted } = feedAll(['Text <review_scratchpad'], 'review_scratchpad');
			expect(text).toBe('Text <review_scratchpad');
			expect(extracted).toBeNull();
		});
	});

	describe('tag extraction', () => {
		it('extracts content and hides it from text', () => {
			const input = 'Before<review_scratchpad>Review notes</review_scratchpad>After';
			const { text, extracted } = feedAll([input], 'review_scratchpad');
			expect(text).toBe('BeforeAfter');
			expect(extracted).toBe('Review notes');
		});

		it('handles multiple occurrences', () => {
			const input = 'A<review_scratchpad>First</review_scratchpad>B<review_scratchpad>Second</review_scratchpad>C';
			const { text, extracted } = feedAll([input], 'review_scratchpad');
			expect(text).toBe('ABC');
			expect(extracted).toBe('FirstSecond');
		});

		it('extracts revised_narrative tag', () => {
			const input = 'Old<revised_narrative>New story version</revised_narrative>';
			const { text, extracted } = feedAll([input], 'revised_narrative');
			expect(text).toBe('Old');
			expect(extracted).toBe('New story version');
		});

		it('handles tag with attributes', () => {
			const input = '<review_scratchpad id="123">Content</review_scratchpad>';
			const { text, extracted } = feedAll([input], 'review_scratchpad');
			expect(text).toBe('');
			expect(extracted).toBe('Content');
		});

		it('trims extracted content', () => {
			const input = '<review_scratchpad>  Spaced content  </review_scratchpad>';
			const { text, extracted } = feedAll([input], 'review_scratchpad');
			expect(text).toBe('');
			expect(extracted).toBe('  Spaced content  ');
		});

		it('returns null for empty/whitespace-only content', () => {
			const input = '<review_scratchpad>   </review_scratchpad>';
			const { text, extracted } = feedAll([input], 'review_scratchpad');
			expect(text).toBe('');
			expect(extracted).toBe('   ');
		});
	});

	describe('chunked streaming', () => {
		it('handles content split across many chunks', () => {
			const input = 'Story<review_scratchpad>Long review content here</review_scratchpad>End';
			const chunks: string[] = [];
			for (let i = 0; i < input.length; i += 2) {
				chunks.push(input.slice(i, i + 2));
			}
			const { text, extracted } = feedAll(chunks, 'review_scratchpad');
			expect(text).toBe('StoryEnd');
			expect(extracted).toBe('Long review content here');
		});

		it('handles tag opener split across chunk boundary', () => {
			const chunks = ['Text<', 'review_', 'scratchpad', '>', 'Content', '</', 'review_scratchpad', '>End'];
			const { text, extracted } = feedAll(chunks, 'review_scratchpad');
			expect(text).toBe('TextEnd');
			expect(extracted).toBe('Content');
		});

		it('handles closer split across chunk boundary', () => {
			const chunks = ['<review_scratchpad>Content<', '/', 'review_scratchpad', '>'];
			const { text, extracted } = feedAll(chunks, 'review_scratchpad');
			expect(text).toBe('');
			expect(extracted).toBe('Content');
		});
	});

	describe('stream interruption', () => {
		it('flushes incomplete opener as text', () => {
			const chunks = ['Hello<review_scratch'];
			const { text, extracted } = feedAll(chunks, 'review_scratchpad');
			expect(text).toBe('Hello<review_scratch');
			expect(extracted).toBeNull();
		});

		it('flushes incomplete tag body as text', () => {
			const chunks = ['Before<review_scratchpad>Incomplete content'];
			const { text, extracted } = feedAll(chunks, 'review_scratchpad');
			expect(text).toBe('Before');
			expect(extracted).toBe('Incomplete content');
		});

		it('flushes incomplete closer as text', () => {
			const chunks = ['<review_scratchpad>Content</'];
			const { text, extracted } = feedAll(chunks, 'review_scratchpad');
			expect(text).toBe('');
			expect(extracted).toBe('Content');
		});

		it('flushes partial closing bracket as text', () => {
			const chunks = ['<review_scratchpad>Content</review_scratchpad'];
			const { text, extracted } = feedAll(chunks, 'review_scratchpad');
			expect(text).toBe('');
			expect(extracted).toBe('Content');
		});
	});

	describe('edge cases', () => {
		it('handles < inside extracted content', () => {
			const input = '<review_scratchpad>He said <that> to me</review_scratchpad>';
			const { text, extracted } = feedAll([input], 'review_scratchpad');
			expect(text).toBe('');
			expect(extracted).toBe('He said <that> to me');
		});

		it('handles </ inside extracted content (not a closer)', () => {
			const input = '<review_scratchpad>Use </div> in HTML</review_scratchpad>';
			const { text, extracted } = feedAll([input], 'review_scratchpad');
			expect(text).toBe('');
			expect(extracted).toBe('Use </div> in HTML');
		});

		it('handles newline in extracted content', () => {
			const input = '<review_scratchpad>Line1\nLine2</review_scratchpad>';
			const { text, extracted } = feedAll([input], 'review_scratchpad');
			expect(text).toBe('');
			expect(extracted).toBe('Line1\nLine2');
		});

		it('handles whitespace-heavy content with trimming', () => {
			const input = '<review_scratchpad>\n  Multi-line\n  content\n</review_scratchpad>';
			const { text, extracted } = feedAll([input], 'review_scratchpad');
			expect(text).toBe('');
			expect(extracted).toBe('\n  Multi-line\n  content\n');
		});

		it('ignores different tag names', () => {
			const input = '<review_scratchpad>A</review_scratchpad><revised_narrative>B</revised_narrative>';
			const { text, extracted } = feedAll([input], 'review_scratchpad');
			expect(text).toBe('<revised_narrative>B</revised_narrative>');
			expect(extracted).toBe('A');
		});
	});
});