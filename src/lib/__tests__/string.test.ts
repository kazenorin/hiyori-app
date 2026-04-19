import { describe, it, expect } from 'vitest';
import { toKebabCase } from '$lib/utils/string';

describe('toKebabCase', () => {
	it('converts simple name to kebab-case', () => {
		expect(toKebabCase('John Doe')).toBe('john-doe');
	});

	it('handles already lowercase names', () => {
		expect(toKebabCase('john doe')).toBe('john-doe');
	});

	it('trims leading and trailing whitespace', () => {
		expect(toKebabCase('  John Doe  ')).toBe('john-doe');
	});

	it('handles multiple spaces', () => {
		expect(toKebabCase('John   Doe')).toBe('john-doe');
	});

	it('removes special filesystem characters', () => {
		expect(toKebabCase('A/B Testing')).toBe('a-b-testing');
		expect(toKebabCase('File\\Name')).toBe('file-name');
		expect(toKebabCase('<Script>')).toBe('script');
		expect(toKebabCase('Chapter: One')).toBe('chapter-one');
		expect(toKebabCase('The "Best" Story')).toBe('the-best-story');
		expect(toKebabCase('A | B')).toBe('a-b');
		expect(toKebabCase('What?')).toBe('what');
		expect(toKebabCase('*.txt')).toBe('txt');
	});

	it('converts underscores to hyphens', () => {
		expect(toKebabCase('my_story_name')).toBe('my-story-name');
	});

	it('handles Unicode characters', () => {
		expect(toKebabCase('物語')).toBe('物語');
		expect(toKebabCase('Histoire française')).toBe('histoire-française');
	});

	it('handles numbers', () => {
		expect(toKebabCase('Story 2')).toBe('story-2');
		expect(toKebabCase('007 Agent')).toBe('007-agent');
	});

	it('handles complex real-world names', () => {
		expect(toKebabCase('Dr. John "The Doc" Smith')).toBe('dr-john-the-doc-smith');
		expect(toKebabCase('Agent 007: License to Kill')).toBe('agent-007-license-to-kill');
	});

	it('handles empty string', () => {
		expect(toKebabCase('')).toBe('');
	});

	it('handles only special characters', () => {
		expect(toKebabCase('???!!!')).toBe('');
	});

	it('handles single word', () => {
		expect(toKebabCase('Alice')).toBe('alice');
	});

	it('handles mixed case and punctuation', () => {
		expect(toKebabCase('Lord Eddard "Ned" Stark')).toBe('lord-eddard-ned-stark');
	});

	it('collapses multiple hyphens', () => {
		expect(toKebabCase('Hello   World!!!')).toBe('hello-world');
	});

	it('strips path traversal sequences', () => {
		expect(toKebabCase('../secret')).toBe('secret');
		expect(toKebabCase('....')).toBe('');
		expect(toKebabCase('foo../bar')).toBe('foo-bar');
	});
});
