import { describe, it, expect, vi } from 'vitest';

const lsMock = vi.fn((key: string) => (key === 'pipeline.labels.plotPlanner.estimatedLength' ? 'Estimated length' : key));
vi.mock('$lib/localization', () => ({
	ls: (key: string) => lsMock(key),
}));

import { parseActPhaseLengthEstimate } from '$lib/ai/plot-planner-output-parser';

describe('parseActPhaseLengthEstimate', () => {
	it('Case 1: header line, value on next line', () => {
		expect(parseActPhaseLengthEstimate('## Estimated length\n\n42')).toBe(42);
	});

	it('Case 1 with colon: header line with colon, value on next line', () => {
		expect(parseActPhaseLengthEstimate('## Estimated length:\n\n42')).toBe(42);
	});

	it('Case 2: colon, value on following line', () => {
		expect(parseActPhaseLengthEstimate('## Estimated length:\n42')).toBe(42);
	});

	it('Case 3a: inline, no colon', () => {
		expect(parseActPhaseLengthEstimate('## Estimated length 42')).toBe(42);
	});

	it('Case 3b: inline with colon', () => {
		expect(parseActPhaseLengthEstimate('## Estimated length: 42')).toBe(42);
	});

	it('Case 4a: bare line', () => {
		expect(parseActPhaseLengthEstimate('Estimated length: 42')).toBe(42);
	});

	it('Case 4b: list item', () => {
		expect(parseActPhaseLengthEstimate('- Estimated length: 42')).toBe(42);
	});

	it('Case 4c: bold label', () => {
		expect(parseActPhaseLengthEstimate('- **Estimated length:** 42')).toBe(42);
	});

	it('body with surrounding text returns first integer', () => {
		expect(parseActPhaseLengthEstimate('## Estimated length\n\nabout 10-15 scenes')).toBe(10);
	});

	it('heading boundary respected', () => {
		expect(parseActPhaseLengthEstimate('## Estimated length\n\n## Standalone Events\n42')).toBeNull();
	});

	it('rejects value below MIN_ESTIMATE', () => {
		expect(parseActPhaseLengthEstimate('## Estimated length\n\n0')).toBeNull();
	});

	it('rejects value above MAX_ESTIMATE', () => {
		expect(parseActPhaseLengthEstimate('## Estimated length\n\n9999')).toBeNull();
	});

	it('missing section returns null', () => {
		expect(parseActPhaseLengthEstimate('## Other heading\n\nfoo')).toBeNull();
	});

	it('empty input returns null', () => {
		expect(parseActPhaseLengthEstimate('')).toBeNull();
	});

	it('null input returns null', () => {
		expect(parseActPhaseLengthEstimate(null)).toBeNull();
	});

	it('stops at next heading when extracting body value', () => {
		const input = '## Estimated length\n\n12\n\n## Chain Events\n...content...50...';
		expect(parseActPhaseLengthEstimate(input)).toBe(12);
	});
});
