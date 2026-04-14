import { describe, it, expect } from 'vitest';
import { _computeLineSubdirForTest as computeLineSubdir, buildLineDir } from '$lib/ai/card-output-path';

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
		// slice(-8) of 'abc-123-xyz' is '-123-xyz'
		expect(result).toBe('-123-xyz');
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
});