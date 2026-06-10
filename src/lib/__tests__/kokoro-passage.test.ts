import { describe, it, expect } from 'vitest';
import { stripFormatting, buildTTSPassage } from '$lib/kokoro/passage';
import type { NarrativeVariables } from '$lib/ai/narrative-types';

describe('stripFormatting', () => {
	it('removes HTML tags', () => {
		expect(stripFormatting('<p>Hello</p>')).toBe('Hello');
		expect(stripFormatting('<b>bold</b> and <i>italic</i>')).toBe('bold and italic');
	});

	it('removes markdown headers', () => {
		expect(stripFormatting('# Title')).toBe('Title');
		expect(stripFormatting('## Subtitle')).toBe('Subtitle');
		expect(stripFormatting('### H3')).toBe('H3');
	});

	it('removes bold markers', () => {
		expect(stripFormatting('**bold** text')).toBe('bold text');
		expect(stripFormatting('__bold__ text')).toBe('bold text');
	});

	it('removes italic markers', () => {
		expect(stripFormatting('*italic* text')).toBe('italic text');
	});

	it('removes bold+italic markers', () => {
		expect(stripFormatting('***bold italic*** text')).toBe('bold italic text');
	});

	it('removes strikethrough', () => {
		expect(stripFormatting('~~deleted~~ text')).toBe('deleted text');
	});

	it('removes inline code', () => {
		expect(stripFormatting('use `code` here')).toBe('use code here');
	});

	it('removes links keeping text', () => {
		expect(stripFormatting('[click me](https://example.com)')).toBe('click me');
	});

	it('removes images entirely', () => {
		expect(stripFormatting('![alt text](image.png)')).toBe('');
	});

	it('removes blockquotes', () => {
		expect(stripFormatting('> quoted text')).toBe('quoted text');
	});

	it('removes unordered list markers', () => {
		expect(stripFormatting('- item one')).toBe('item one');
		expect(stripFormatting('* item two')).toBe('item two');
	});

	it('removes ordered list markers', () => {
		expect(stripFormatting('1. first item')).toBe('first item');
		expect(stripFormatting('99. item')).toBe('item');
	});

	it('removes horizontal rules', () => {
		expect(stripFormatting('---')).toBe('');
		expect(stripFormatting('***')).toBe('');
		expect(stripFormatting('___')).toBe('');
	});

	it('preserves sentence-ending punctuation', () => {
		expect(stripFormatting('Hello, world! How are you?')).toBe('Hello, world! How are you?');
	});

	it('collapses multiple blank lines', () => {
		expect(stripFormatting('para 1\n\n\n\npara 2')).toBe('para 1\n\npara 2');
	});

	it('trims whitespace', () => {
		expect(stripFormatting('  hello  ')).toBe('hello');
	});

	it('handles combined formatting', () => {
		const input = '# Title\n\n**Bold** and *italic* with `code` and [link](url)\n\n> quote';
		const result = stripFormatting(input);
		expect(result).toBe('Title\n\nBold and italic with code and link\n\nquote');
	});

	it('strips markdown that KokoroJS phonemizer would read aloud', () => {
		const input = '**The dragon** approached. *Slowly*, it breathed ~~fire~~ ice.';
		expect(stripFormatting(input)).toBe('The dragon approached. Slowly, it breathed fire ice.');
	});

	it('handles empty string', () => {
		expect(stripFormatting('')).toBe('');
	});
});

describe('buildTTSPassage', () => {
	it('builds passage from NarrativeVariables with template metadata', () => {
		const variables: NarrativeVariables = {
			sceneTitle: 'The Beginning',
			background: 'A dark forest',
			narrativeBody: 'The hero stepped forward **boldly**.',
			turnOfEvents: null,
			cg: 'The forest glowed *softly*.',
			gameData: null,
		};

		const result = buildTTSPassage(variables, undefined);
		expect(result).toBe('The Beginning\n\nA dark forest\n\nThe hero stepped forward boldly.\n\nThe forest glowed softly.');
	});

	it('falls back to content when no template metadata', () => {
		const result = buildTTSPassage(undefined, 'Just plain **text** here.');
		expect(result).toBe('Just plain text here.');
	});

	it('skips null fields', () => {
		const variables: NarrativeVariables = {
			sceneTitle: 'Scene',
			background: null,
			narrativeBody: 'Body text.',
			turnOfEvents: null,
			cg: null,
			gameData: null,
		};

		const result = buildTTSPassage(variables, undefined);
		expect(result).toBe('Scene\n\nBody text.');
	});

	it('returns empty string when no variables and no content', () => {
		expect(buildTTSPassage(undefined, undefined)).toBe('');
	});
});
