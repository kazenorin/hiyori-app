import { describe, it, expect, vi, afterEach } from 'vitest';

let labelOverride: string | null = null;
const lsMock = vi.fn((key: string) => {
	if (key !== 'pipeline.labels.plotPlanner.estimatedLength') return key;
	return labelOverride ?? 'Estimated length';
});
afterEach(() => {
	labelOverride = null;
});
vi.mock('#lib/localization/index.ts', () => ({
	ls: (key: string) => lsMock(key),
}));

import { parseActPhaseLengthEstimate, splitScenePlotEstimate, joinScenePlotEstimate } from '#lib/ai/plot-planner-output-parser.ts';

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

describe('splitScenePlotEstimate', () => {
	it('removes the trailing estimate section from the prose', () => {
		const input = '## Chain Events\n\nThe bell rings.\n\n## Estimated length\n\n42';
		expect(splitScenePlotEstimate(input)).toEqual({
			prose: '## Chain Events\n\nThe bell rings.',
			estimate: 42,
			labelPrefix: '## Estimated length',
		});
	});

	it('keeps the label verbatim so saving cannot rewrite a story-locale heading', () => {
		labelOverride = '預計長度';
		const input = 'Body text.\n\n## 預計長度:\n\n7';
		expect(splitScenePlotEstimate(input).labelPrefix).toBe('## 預計長度:');
	});

	it('returns the whole text as prose when the section is absent', () => {
		const input = '## Chain Events\n\nThe bell rings.';
		expect(splitScenePlotEstimate(input)).toEqual({
			prose: input,
			estimate: null,
			labelPrefix: null,
		});
	});

	it('leaves a following section intact', () => {
		const input = '## Estimated length\n\n12\n\n## Chain Events\n\n50 scenes of content';
		expect(splitScenePlotEstimate(input)).toEqual({
			prose: '## Chain Events\n\n50 scenes of content',
			estimate: 12,
			labelPrefix: '## Estimated length',
		});
	});

	it('handles the inline form', () => {
		expect(splitScenePlotEstimate('Prose.\n\n- **Estimated length:** 42')).toEqual({
			prose: 'Prose.',
			estimate: 42,
			labelPrefix: '- **Estimated length:**',
		});
	});

	it('discards an out-of-range value the pipeline would also reject', () => {
		expect(splitScenePlotEstimate('Prose.\n\n## Estimated length\n\n9999')).toEqual({
			prose: 'Prose.',
			estimate: null,
			labelPrefix: '## Estimated length',
		});
	});

	it('agrees with parseActPhaseLengthEstimate on every supported format', () => {
		const inputs = [
			'## Estimated length\n\n42',
			'## Estimated length:\n42',
			'## Estimated length: 42',
			'- Estimated length: 42',
			'## Estimated length\n\nabout 10-15 scenes',
			'## Estimated length\n\n## Standalone Events\n42',
			'## Estimated length\n\n0',
			'## Other heading\n\nfoo',
			'',
		];
		for (const input of inputs) {
			expect(splitScenePlotEstimate(input).estimate).toBe(parseActPhaseLengthEstimate(input));
		}
	});
});

describe('joinScenePlotEstimate', () => {
	it('reassembles prose with the original label and the new value', () => {
		labelOverride = '預計長度';
		const parts = splitScenePlotEstimate('Prose.\n\n## 預計長度:\n\n7');
		expect(joinScenePlotEstimate(parts.prose, 9, parts.labelPrefix)).toBe('Prose.\n\n## 預計長度:\n\n9');
	});

	it('emits the localized heading when the plot had no estimate section', () => {
		expect(joinScenePlotEstimate('Prose.', 2, null)).toBe('Prose.\n\n## Estimated length\n\n2');
	});

	it('emits only the section when the prose is empty', () => {
		expect(joinScenePlotEstimate('  ', 5, null)).toBe('## Estimated length\n\n5');
	});

	it('round-trips to the value the pipeline will parse', () => {
		const parts = splitScenePlotEstimate('Prose.\n\n## Estimated length\n\n7');
		expect(parseActPhaseLengthEstimate(joinScenePlotEstimate(parts.prose, 13, parts.labelPrefix))).toBe(13);
	});
});
