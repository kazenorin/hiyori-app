import { describe, it, expect } from 'vitest';
import { canonicalName, deriveStoryName } from '../fs/story-prompts';

describe('canonicalName', () => {
	it('returns unchanged name for safe characters', () => {
		expect(canonicalName('Hello World')).toBe('Hello World');
		expect(canonicalName('My Story Name')).toBe('My Story Name');
	});

	it('removes filesystem unsafe characters', () => {
		expect(canonicalName('Hello/World')).toBe('HelloWorld');
		expect(canonicalName('Hello\\World')).toBe('HelloWorld');
		expect(canonicalName('Hello:World')).toBe('HelloWorld');
		expect(canonicalName('Hello*World')).toBe('HelloWorld');
		expect(canonicalName('Hello?World')).toBe('HelloWorld');
		expect(canonicalName('Hello<World>')).toBe('HelloWorld');
		expect(canonicalName('Hello"World')).toBe('HelloWorld');
		expect(canonicalName('Hello|World')).toBe('HelloWorld');
	});

	it('removes control characters', () => {
		expect(canonicalName('Hello\x00World')).toBe('HelloWorld');
		expect(canonicalName('Hello\x1FWorld')).toBe('HelloWorld');
	});

	it('trims trailing spaces and dots', () => {
		expect(canonicalName('Hello World   ')).toBe('Hello World');
		expect(canonicalName('Hello World...')).toBe('Hello World');
		expect(canonicalName('Hello World . . ')).toBe('Hello World');
	});

	it('trims leading spaces', () => {
		expect(canonicalName('   Hello World')).toBe('Hello World');
	});

	it('returns empty string when all characters are unsafe', () => {
		expect(canonicalName('///')).toBe('');
		expect(canonicalName(':::')).toBe('');
		expect(canonicalName('***')).toBe('');
	});

	it('returns empty string for whitespace-only input', () => {
		expect(canonicalName('   ')).toBe('');
		expect(canonicalName('\t\t')).toBe('');
	});

	it('preserves Unicode characters', () => {
		expect(canonicalName('日本語ストーリー')).toBe('日本語ストーリー');
		expect(canonicalName('Émoji Story 🎭')).toBe('Émoji Story 🎭');
	});
});

describe('deriveStoryName', () => {
	it('returns canonical name when non-empty', () => {
		expect(deriveStoryName('My Story', 'abc-123-def')).toBe('My Story');
		expect(deriveStoryName('Hello World', 'xyz-456')).toBe('Hello World');
	});

	it('falls back to story-{shortId} when canonical is empty', () => {
		expect(deriveStoryName('///', 'abc-123-def')).toBe('story-abc');
		expect(deriveStoryName(':::', 'xyz-456-789')).toBe('story-xyz');
	});

	it('falls back for whitespace-only input', () => {
		expect(deriveStoryName('   ', 'abc-123')).toBe('story-abc');
		expect(deriveStoryName('\t\t', 'xyz-456')).toBe('story-xyz');
	});

	it('uses first segment of UUID for shortId', () => {
		expect(deriveStoryName('', 'a1b2c3d4-e5f6-7890')).toBe('story-a1b2c3d4');
	});
});