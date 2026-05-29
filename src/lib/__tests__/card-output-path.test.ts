import { describe, it, expect } from 'vitest';

import {
	_computeLineSubdirForTest as computeLineSubdir,
	_buildLineSubdirSuffixForTest as buildLineSubdirSuffix,
	buildLineDir,
} from '$lib/ai/card-output-path';

describe('computeLineSubdir', () => {
	it('returns "main-line" for main line', () => {
		const result = computeLineSubdir(true, 'abc-123-xyz');
		expect(result).toBe('main-line');
	});

	it('returns last 8 chars of act line ID for non-main line', () => {
		const result = computeLineSubdir(false, '1234567890abcdef');
		expect(result).toBe('90abcdef');
	});

	it('handles short IDs', () => {
		const result = computeLineSubdir(false, 'abc');
		expect(result).toBe('abc');
	});

	it('handles IDs with dashes', () => {
		const result = computeLineSubdir(false, 'abc-123-xyz');
		expect(result).toBe('-123-xyz');
	});

	it('appends suffix when provided', () => {
		const result = computeLineSubdir(false, '1234567890abcdef', 'fork-from-scene-2');
		expect(result).toBe('90abcdef-fork-from-scene-2');
	});

	it('ignores empty suffix', () => {
		const result = computeLineSubdir(false, '1234567890abcdef', '');
		expect(result).toBe('90abcdef');
	});

	it('ignores suffix for main line', () => {
		const result = computeLineSubdir(true, '1234567890abcdef', 'some-suffix');
		expect(result).toBe('main-line');
	});
});

describe('buildLineSubdirSuffix', () => {
	it('converts name to kebab-case', () => {
		expect(buildLineSubdirSuffix('Fork from "Scene 2: The Dark Forest"')).toBe('fork-from-scene-2-the-dark-forest');
	});

	it('limits to first 8 words', () => {
		const result = buildLineSubdirSuffix('one two three four five six seven eight nine ten');
		expect(result).toBe('one-two-three-four-five-six-seven-eight');
	});

	it('caps at 100 characters', () => {
		const longName = Array(20).fill('supercalifragilistic').join(' ');
		const result = buildLineSubdirSuffix(longName);
		expect(result.length).toBeLessThanOrEqual(100);
	});

	it('returns empty string for empty input', () => {
		expect(buildLineSubdirSuffix('')).toBe('');
	});

	it('returns empty string for whitespace-only input', () => {
		expect(buildLineSubdirSuffix('   ')).toBe('');
	});

	it('handles single word', () => {
		expect(buildLineSubdirSuffix('main')).toBe('main');
	});

	it('handles numbers as words', () => {
		expect(buildLineSubdirSuffix('Scene 2 Test')).toBe('scene-2-test');
	});
});

describe('buildLineDir', () => {
	it('builds path for main line', () => {
		const result = buildLineDir('/stories/my-story', 1, true, 'any-id');
		expect(result).toBe('/stories/my-story/act-1/main-line');
	});

	it('builds path for non-main line', () => {
		const result = buildLineDir('/stories/my-story', 2, false, '1234567890abcdef');
		expect(result).toBe('/stories/my-story/act-2/90abcdef');
	});

	it('handles act numbers greater than 9', () => {
		const result = buildLineDir('/stories/my-story', 12, true, 'any-id');
		expect(result).toBe('/stories/my-story/act-12/main-line');
	});

	it('builds path with suffix for non-main line', () => {
		const result = buildLineDir('/stories/my-story', 2, false, '1234567890abcdef', 'fork-from-scene-2');
		expect(result).toBe('/stories/my-story/act-2/90abcdef-fork-from-scene-2');
	});

	it('ignores suffix for main line', () => {
		const result = buildLineDir('/stories/my-story', 1, true, 'any-id', 'some-suffix');
		expect(result).toBe('/stories/my-story/act-1/main-line');
	});
});
