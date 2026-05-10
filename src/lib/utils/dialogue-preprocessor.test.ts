import { describe, it, expect } from 'vitest';
import { preprocessDialogue } from './dialogue-preprocessor';

describe('preprocessDialogue', () => {
	it('wraps basic dialogue in span.dialogue', () => {
		expect(preprocessDialogue('He said "hello"')).toBe('He said <span class="dialogue">"hello"</span>');
	});

	it('wraps multiple dialogue quotes', () => {
		expect(preprocessDialogue('"a" and "b"')).toBe('<span class="dialogue">"a"</span> and <span class="dialogue">"b"</span>');
	});

	it('does not modify unpaired quotes', () => {
		expect(preprocessDialogue('He said "hello')).toBe('He said "hello');
	});

	it('wraps empty quotes', () => {
		expect(preprocessDialogue('""')).toBe('<span class="dialogue">""</span>');
	});

	it('protects quotes inside HTML block elements', () => {
		expect(preprocessDialogue('<div class="foo">"hello"</div>')).toBe('<div class="foo">"hello"</div>');
	});

	it('protects quotes inside <header> blocks', () => {
		expect(preprocessDialogue('<header class="x">"skip"</header>')).toBe('<header class="x">"skip"</header>');
	});

	it('protects quotes inside <aside> blocks', () => {
		expect(preprocessDialogue('<aside class="x">"skip"</aside>')).toBe('<aside class="x">"skip"</aside>');
	});

	it('processes prose between HTML blocks', () => {
		expect(preprocessDialogue('Text <div>"skip"</div> "wrap"')).toBe('Text <div>"skip"</div> <span class="dialogue">"wrap"</span>');
	});

	it('wraps quotes inside bold markdown', () => {
		expect(preprocessDialogue('**"bold"**')).toBe('**<span class="dialogue">"bold"</span>**');
	});

	it('wraps quotes inside italic markdown', () => {
		expect(preprocessDialogue('*"italic"*')).toBe('*<span class="dialogue">"italic"</span>*');
	});

	it('handles dialogue with punctuation inside', () => {
		expect(preprocessDialogue('She whispered "hello, world!"')).toBe('She whispered <span class="dialogue">"hello, world!"</span>');
	});

	it('does not double-wrap existing span.dialogue in HTML blocks', () => {
		expect(preprocessDialogue('<div><span class="dialogue">"hi"</span></div>')).toBe('<div><span class="dialogue">"hi"</span></div>');
	});

	it('handles multiple HTML blocks and prose', () => {
		const input = '"start" <div>"skip1"</div> middle <aside>"skip2"</aside> "end"';
		const result = preprocessDialogue(input);
		expect(result).toBe(
			'<span class="dialogue">"start"</span> <div>"skip1"</div> middle <aside>"skip2"</aside> <span class="dialogue">"end"</span>'
		);
	});

	it('handles self-closing HTML tags in attributes', () => {
		expect(preprocessDialogue('<div class="foo"><br/>"text"</div>')).toBe('<div class="foo"><br/>"text"</div>');
	});

	it('preserves content with no quotes unchanged', () => {
		expect(preprocessDialogue('No quotes here')).toBe('No quotes here');
	});

	it('preserves empty string', () => {
		expect(preprocessDialogue('')).toBe('');
	});
});
