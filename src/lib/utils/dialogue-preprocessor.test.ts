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

	describe('inventory item highlighting', () => {
		it('wraps a single inventory item', () => {
			expect(preprocessDialogue('He drew the Sword.', [], ['Sword'])).toBe('He drew the <span class="inventory-item">Sword</span>.');
		});

		it('wraps multiple inventory items', () => {
			expect(preprocessDialogue('He took the Sword and Shield.', [], ['Sword', 'Shield'])).toBe(
				'He took the <span class="inventory-item">Sword</span> and <span class="inventory-item">Shield</span>.'
			);
		});

		it('does not wrap items inside dialogue spans', () => {
			expect(preprocessDialogue('"Take the Sword," he said.', [], ['Sword'])).toBe(
				'<span class="dialogue">"Take the Sword,"</span> he said.'
			);
		});

		it('does not wrap items inside character-name spans', () => {
			expect(preprocessDialogue('Arthur nodded.', ['Arthur'], ['Arthur'])).toBe('<span class="character-name">Arthur</span> nodded.');
		});

		it('does not wrap items inside HTML blocks', () => {
			expect(preprocessDialogue('<div>Sword</div>', [], ['Sword'])).toBe('<div>Sword</div>');
		});

		it('matches longer names before shorter ones', () => {
			expect(preprocessDialogue('He drew the Longsword.', [], ['Sword', 'Longsword'])).toBe(
				'He drew the <span class="inventory-item">Longsword</span>.'
			);
		});

		it('uses word boundaries to avoid partial matches', () => {
			expect(preprocessDialogue('The swordsmith worked.', [], ['Sword'])).toBe('The swordsmith worked.');
		});

		it('handles empty inventoryNames (no-op)', () => {
			expect(preprocessDialogue('Sword here.', [], [])).toBe('Sword here.');
		});
	});

	describe('combined dialogue + character names + inventory', () => {
		it('highlights all three types', () => {
			expect(preprocessDialogue('Arthur drew the Sword.', ['Arthur'], ['Sword'])).toBe(
				'<span class="character-name">Arthur</span> drew the <span class="inventory-item">Sword</span>.'
			);
		});

		it('inventory takes precedence when name and item share text but are separate spans', () => {
			expect(preprocessDialogue('Arthur held the Sword and spoke "hello"', ['Arthur'], ['Sword'])).toBe(
				'<span class="character-name">Arthur</span> held the <span class="inventory-item">Sword</span> and spoke <span class="dialogue">"hello"</span>'
			);
		});

		it('character name inside dialogue is not highlighted', () => {
			expect(preprocessDialogue('"Arthur!" he called.', ['Arthur'], [])).toBe('<span class="dialogue">"Arthur!"</span> he called.');
		});

		it('inventory item inside dialogue is not highlighted', () => {
			expect(preprocessDialogue('"Take the Sword," he said.', [], ['Sword'])).toBe(
				'<span class="dialogue">"Take the Sword,"</span> he said.'
			);
		});
	});
});
