import { describe, it, expect } from 'vitest';
import { createThinkingTagParser } from '../ai/thinking-tag-parser';

const THINK_TAG_NAME = 'think';

function feedAll(chunks: string[]): { text: string; thinking: string | null } {
	const parser = createThinkingTagParser();
	let text = '';
	let thinking: string | null = null;

	for (const chunk of chunks) {
		const output = parser.feed(chunk);
		if (output.text) text += output.text;
		if (output.thinking) thinking = (thinking ?? '') + output.thinking;
	}

	const flushed = parser.flush();
	if (flushed.text) text += flushed.text;
	if (flushed.thinking) thinking = (thinking ?? '') + flushed.thinking;

	return { text, thinking };
}

describe('ThinkingTagParser', () => {
	describe('plain text passthrough', () => {
		it('passes plain text through unchanged', () => {
			const { text, thinking } = feedAll(['Hello, world!']);
			expect(text).toBe('Hello, world!');
			expect(thinking).toBeNull();
		});

		it('passes text with HTML-like tags that are not think tags', () => {
			const { text, thinking } = feedAll(['Use <div> for containers']);
			expect(text).toBe('Use <div> for containers');
			expect(thinking).toBeNull();
		});

		it('passes partial think-like tags through as text', () => {
			const { text, thinking } = feedAll(['The thinker sat quietly']);
			expect(text).toBe('The thinker sat quietly');
			expect(thinking).toBeNull();
		});
	});

	describe('simple think tag extraction', () => {
		it(`extracts thinking from simple <${THINK_TAG_NAME}...</${THINK_TAG_NAME}> tags`, () => {
			const input = `Before<${THINK_TAG_NAME}>This is reasoning</${THINK_TAG_NAME}>After`;
			const { text, thinking } = feedAll([input]);
			expect(text).toBe('BeforeAfter');
			expect(thinking).toBe('This is reasoning');
		});

		it('handles thinking at the start of content', () => {
			const input = `<${THINK_TAG_NAME}>First thought</${THINK_TAG_NAME}>Then text`;
			const { text, thinking } = feedAll([input]);
			expect(text).toBe('Then text');
			expect(thinking).toBe('First thought');
		});

		it('handles thinking as the entire content', () => {
			const input = `<${THINK_TAG_NAME}>Pure thinking</${THINK_TAG_NAME}>`;
			const { text, thinking } = feedAll([input]);
			expect(text).toBe('');
			expect(thinking).toBe('Pure thinking');
		});

		it('trims thinking content', () => {
			const input = `<${THINK_TAG_NAME}>  Spaced content   </${THINK_TAG_NAME}>`;
			const { thinking } = feedAll([input]);
			expect(thinking).toBe('Spaced content');
		});
	});

	describe('think tags with attributes', () => {
		it(`extracts thinking from <${THINK_TAG_NAME} budget="10000">...</${THINK_TAG_NAME}>`, () => {
			const input = `Text<${THINK_TAG_NAME} budget="10000">Deep reasoning</${THINK_TAG_NAME}>More`;
			const { text, thinking } = feedAll([input]);
			expect(text).toBe('TextMore');
			expect(thinking).toBe('Deep reasoning');
		});

		it('handles multiple attributes', () => {
			const input = `<${THINK_TAG_NAME} budget="10000" effort="high">Complex thought</${THINK_TAG_NAME}>`;
			const { text, thinking } = feedAll([input]);
			expect(text).toBe('');
			expect(thinking).toBe('Complex thought');
		});

		it('handles attributes with spaces', () => {
			const input = `<${THINK_TAG_NAME}  budget = "10000" >Thought</${THINK_TAG_NAME}>`;
			const { text, thinking } = feedAll([input]);
			expect(text).toBe('');
			expect(thinking).toBe('Thought');
		});
	});

	describe('multiple thinking blocks', () => {
		it('extracts multiple thinking blocks and concatenates', () => {
			const input = `A<${THINK_TAG_NAME}>First</${THINK_TAG_NAME}>B<${THINK_TAG_NAME}>Second</${THINK_TAG_NAME}>C`;
			const { text, thinking } = feedAll([input]);
			expect(text).toBe('ABC');
			expect(thinking).toBe('FirstSecond');
		});

		it('handles three thinking blocks', () => {
			const input = `<${THINK_TAG_NAME}>1</${THINK_TAG_NAME}>Text<${THINK_TAG_NAME}>2</think>More<${THINK_TAG_NAME}>3</${THINK_TAG_NAME}>`;
			const { text, thinking } = feedAll([input]);
			expect(text).toBe('TextMore');
			expect(thinking).toBe('123');
		});
	});

	describe('chunked streaming', () => {
		it('handles thinking split across many chunks', () => {
			const input = `Story<${THINK_TAG_NAME}>Long reasoning content here</${THINK_TAG_NAME}>End`;
			// Split into 2-char chunks
			const chunks: string[] = [];
			for (let i = 0; i < input.length; i += 2) {
				chunks.push(input.slice(i, i + 2));
			}
			const { text, thinking } = feedAll(chunks);
			expect(text).toBe('StoryEnd');
			expect(thinking).toBe('Long reasoning content here');
		});

		it('handles tag opener split across chunk boundary', () => {
			const chunks = ['Text<', THINK_TAG_NAME.slice(0, 4), THINK_TAG_NAME.slice(-1), '>', 'Thought', '</', THINK_TAG_NAME, '>End'];
			const { text, thinking } = feedAll(chunks);
			expect(text).toBe('TextEnd');
			expect(thinking).toBe('Thought');
		});

		it('handles closer split across chunk boundary', () => {
			const chunks = [`<${THINK_TAG_NAME}>Content<`, '/', THINK_TAG_NAME, '>'];
			const { text, thinking } = feedAll(chunks);
			expect(text).toBe('');
			expect(thinking).toBe('Content');
		});
	});

	describe('stream interruption', () => {
		it('flushes incomplete opener as text', () => {
			const chunks = ['Hello<' + THINK_TAG_NAME.slice(0, 4)];
			const { text, thinking } = feedAll(chunks);
			expect(text).toBe('Hello<' + THINK_TAG_NAME.slice(0, 4));
			expect(thinking).toBeNull();
		});

		it('flushes incomplete thinking body as text', () => {
			const chunks = [`Before<${THINK_TAG_NAME}>Incomplete thought`];
			const { text, thinking } = feedAll(chunks);
			expect(text).toBe(`Before<${THINK_TAG_NAME}>Incomplete thought`);
			expect(thinking).toBeNull();
		});

		it('flushes incomplete closer as text', () => {
			const chunks = [`<${THINK_TAG_NAME}>Content</`];
			const { text, thinking } = feedAll(chunks);
			expect(text).toBe(`<${THINK_TAG_NAME}>Content</`);
			expect(thinking).toBeNull();
		});

		it('flushes partial closing bracket as text', () => {
			const chunks = [`<${THINK_TAG_NAME}>Content</${THINK_TAG_NAME}`];
			const { text, thinking } = feedAll(chunks);
			expect(text).toBe(`<${THINK_TAG_NAME}>Content</${THINK_TAG_NAME}`);
			expect(thinking).toBeNull();
		});
	});

	describe('edge cases', () => {
		it('handles empty thinking content (null, not empty string)', () => {
			const input = `Before<${THINK_TAG_NAME}></${THINK_TAG_NAME}>After`;
			const { text, thinking } = feedAll([input]);
			expect(text).toBe('BeforeAfter');
			expect(thinking).toBeNull();
		});

		it('handles < inside thinking content', () => {
			const input = `<${THINK_TAG_NAME}>He said <that> to me</${THINK_TAG_NAME}>`;
			const { text, thinking } = feedAll([input]);
			expect(text).toBe('');
			expect(thinking).toBe('He said <that> to me');
		});

		it('handles </ inside thinking content (not a closer)', () => {
			const input = `<${THINK_TAG_NAME}>Use </div> in HTML</${THINK_TAG_NAME}>`;
			const { text, thinking } = feedAll([input]);
			expect(text).toBe('');
			expect(thinking).toBe('Use </div> in HTML');
		});

		it('handles newline in thinking content', () => {
			const input = `<${THINK_TAG_NAME}>Line1\nLine2</${THINK_TAG_NAME}>`;
			const { text, thinking } = feedAll([input]);
			expect(text).toBe('');
			expect(thinking).toBe('Line1\nLine2');
		});

		it('handles attributes with newline', () => {
			const input = `<${THINK_TAG_NAME}\nbudget="10000">Thought</${THINK_TAG_NAME}>`;
			const { text, thinking } = feedAll([input]);
			expect(text).toBe('');
			expect(thinking).toBe('Thought');
		});

		it('handles nested angle brackets in opener attributes', () => {
			// <value> inside attr causes parser to treat first > as tag close
			// Unlikely edge case — models don't put <> in think attrs
			const input = `<${THINK_TAG_NAME} attr="<value>">Content</${THINK_TAG_NAME}>`;
			const { text, thinking } = feedAll([input]);
			expect(text).toBe('');
			expect(thinking).toBe('">Content');
		});
	});
});
