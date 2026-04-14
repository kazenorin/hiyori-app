import { describe, it, expect } from 'vitest';
import { canonicalName } from '$lib/fs/story-folders';

describe('canonicalName', () => {
	it('preserves simple names', () => {
		expect(canonicalName('My Story')).toBe('My Story');
	});

	it('removes forward slashes', () => {
		expect(canonicalName('path/to/story')).toBe('pathtostory');
	});

	it('removes backslashes', () => {
		expect(canonicalName('path\\to\\story')).toBe('pathtostory');
	});

	it('removes angle brackets', () => {
		expect(canonicalName('<script>')).toBe('script');
	});

	it('removes colons', () => {
		expect(canonicalName('Chapter: One')).toBe('Chapter One');
	});

	it('removes double quotes', () => {
		expect(canonicalName('The "Best" Story')).toBe('The Best Story');
	});

	it('removes pipe', () => {
		expect(canonicalName('A | B')).toBe('A  B');
	});

	it('removes question marks', () => {
		expect(canonicalName('What?')).toBe('What');
	});

	it('removes asterisks', () => {
		expect(canonicalName('*.txt')).toBe('.txt');
	});

	it('removes control characters', () => {
		expect(canonicalName('hello\x00world')).toBe('helloworld');
		expect(canonicalName('tab\there')).toBe('tabhere');
	});

	it('removes all special chars at once', () => {
		expect(canonicalName('/\\<>:"|?*')).toBe('');
	});

	it('trims trailing spaces', () => {
		expect(canonicalName('Story   ')).toBe('Story');
	});

	it('trims trailing dots', () => {
		expect(canonicalName('Story...')).toBe('Story');
	});

	it('trims trailing mixed spaces and dots', () => {
		expect(canonicalName('Story . . ')).toBe('Story');
	});

	it('trims leading spaces', () => {
		expect(canonicalName('   Story')).toBe('Story');
	});

	it('preserves Unicode characters', () => {
		expect(canonicalName('物語')).toBe('物語');
		expect(canonicalName('Histoire française')).toBe('Histoire française');
	});

	it('preserves hyphens and underscores', () => {
		expect(canonicalName('my-story_name')).toBe('my-story_name');
	});

	it('preserves numbers', () => {
		expect(canonicalName('Story 2')).toBe('Story 2');
	});

	it('returns empty string for all-special input', () => {
		expect(canonicalName('???')).toBe('');
	});

	it('handles empty string', () => {
		expect(canonicalName('')).toBe('');
	});

	it('handles single character', () => {
		expect(canonicalName('A')).toBe('A');
	});
});
