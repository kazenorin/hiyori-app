import { describe, it, expect } from 'vitest';
import { preprocessDialogue } from './dialogue-preprocessor';

describe('preprocessDialogue', () => {
	describe('dialogue highlighting', () => {
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

		it('handles self-closing HTML tags inside HTML blocks', () => {
			expect(preprocessDialogue('<div class="foo"><br/>"text"</div>')).toBe('<div class="foo"><br/>"text"</div>');
		});

		it('preserves content with no quotes unchanged', () => {
			expect(preprocessDialogue('No quotes here')).toBe('No quotes here');
		});

		it('preserves empty string', () => {
			expect(preprocessDialogue('')).toBe('');
		});

		it('does not match quotes in HTML attributes of inline tags', () => {
			expect(preprocessDialogue('<span class="foo">text</span>')).toBe('<span class="foo">text</span>');
		});
	});

	describe('character name highlighting', () => {
		it('wraps a single character name', () => {
			expect(preprocessDialogue('Arthur nodded.', ['Arthur'])).toBe('<span class="character-name">Arthur</span> nodded.');
		});

		it('wraps multiple occurrences of the same name', () => {
			expect(preprocessDialogue('Arthur spoke. Arthur left.', ['Arthur'])).toBe(
				'<span class="character-name">Arthur</span> spoke. <span class="character-name">Arthur</span> left.'
			);
		});

		it('wraps aliases after articles', () => {
			expect(preprocessDialogue('The King entered.', ['King'])).toBe('The <span class="character-name">King</span> entered.');
		});

		it('matches longer names before shorter ones to avoid partial matches', () => {
			expect(preprocessDialogue('Sir Arthur nodded.', ['Arthur', 'Sir Arthur'])).toBe(
				'<span class="character-name">Sir Arthur</span> nodded.'
			);
		});

		it('uses word boundaries to avoid partial matches', () => {
			expect(preprocessDialogue('The cathedral loomed.', ['Cath'])).toBe('The cathedral loomed.');
		});

		it('does not wrap names inside dialogue spans', () => {
			expect(preprocessDialogue('"Hello Arthur"', ['Arthur'])).toBe('<span class="dialogue">"Hello Arthur"</span>');
		});

		it('wraps names outside dialogue but not inside', () => {
			expect(preprocessDialogue('Arthur said "hello"', ['Arthur'])).toBe(
				'<span class="character-name">Arthur</span> said <span class="dialogue">"hello"</span>'
			);
		});

		it('does not wrap names inside HTML blocks', () => {
			expect(preprocessDialogue('<div>Arthur</div>', ['Arthur'])).toBe('<div>Arthur</div>');
		});

		it('wraps names between HTML blocks', () => {
			expect(preprocessDialogue('Arthur <div>skip</div> Merlin', ['Arthur', 'Merlin'])).toBe(
				'<span class="character-name">Arthur</span> <div>skip</div> <span class="character-name">Merlin</span>'
			);
		});

		it('handles empty characterNames array (no-op)', () => {
			expect(preprocessDialogue('Arthur nodded.', [])).toBe('Arthur nodded.');
		});

		it('handles characterNames undefined (no-op)', () => {
			expect(preprocessDialogue('Arthur nodded.')).toBe('Arthur nodded.');
		});
	});

	describe('combined dialogue + character names', () => {
		it('highlights both dialogue and names in prose', () => {
			expect(preprocessDialogue('Arthur said "hello" to Merlin.', ['Arthur', 'Merlin'])).toBe(
				'<span class="character-name">Arthur</span> said <span class="dialogue">"hello"</span> to <span class="character-name">Merlin</span>.'
			);
		});

		it('does not highlight name inside dialogue', () => {
			expect(preprocessDialogue('"Hello, Arthur!" he said.', ['Arthur'])).toBe('<span class="dialogue">"Hello, Arthur!"</span> he said.');
		});

		it('highlights name after dialogue on same line', () => {
			expect(preprocessDialogue('"Yes," Arthur replied.', ['Arthur'])).toBe(
				'<span class="dialogue">"Yes,"</span> <span class="character-name">Arthur</span> replied.'
			);
		});
	});
});
