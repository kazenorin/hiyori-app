import { describe, it, expect, vi, beforeEach } from 'vitest';

const lsMock = vi.fn((key: string) => key);
vi.mock('$lib/localization', () => ({
	ls: (key: string) => lsMock(key),
}));

import { computeTargetWordCountRange, parseActPlotTargetWordCount } from '$lib/ai/act-plot/target-word-count-parser';

const LABEL = 'Target Word Count per Scene';

describe('computeTargetWordCountRange', () => {
	it('returns 300-500 for the default 400', () => {
		expect(computeTargetWordCountRange(400)).toBe('300-500');
	});

	it('clamps lower bound to 50 for small settings values', () => {
		expect(computeTargetWordCountRange(50)).toBe('50-150');
		expect(computeTargetWordCountRange(100)).toBe('50-200');
		expect(computeTargetWordCountRange(120)).toBe('50-220');
		expect(computeTargetWordCountRange(149)).toBe('50-249');
		expect(computeTargetWordCountRange(150)).toBe('50-250');
	});

	it('does not clamp when settings value exceeds the floor', () => {
		expect(computeTargetWordCountRange(151)).toBe('51-251');
		expect(computeTargetWordCountRange(200)).toBe('100-300');
	});

	it('supports large settings values up to the UI max (2000)', () => {
		expect(computeTargetWordCountRange(2000)).toBe('1900-2100');
	});
});

describe('parseActPlotTargetWordCount', () => {
	beforeEach(() => {
		lsMock.mockReset();
		lsMock.mockImplementation((key: string) => (key === 'common.headers.targetWordCountPerScene' ? LABEL : key));
	});

	it('returns null for null/undefined/empty input', () => {
		expect(parseActPlotTargetWordCount(null)).toBeNull();
		expect(parseActPlotTargetWordCount(undefined)).toBeNull();
		expect(parseActPlotTargetWordCount('')).toBeNull();
	});

	it('returns null when the localized label is missing from ls cache', () => {
		lsMock.mockImplementation(() => '');
		expect(parseActPlotTargetWordCount('some content')).toBeNull();
	});

	it('returns null when no line contains the label', () => {
		const actPlot = '# Act Plot\n\n## Premise\n\nNo word count line here.';
		expect(parseActPlotTargetWordCount(actPlot)).toBeNull();
	});

	it('returns null when the label line has fewer than two integers', () => {
		const actPlot = `- ${LABEL}: 400`;
		expect(parseActPlotTargetWordCount(actPlot)).toBeNull();
	});

	it('parses the bracketed template default 400-500 to 450', () => {
		const actPlot = `- ${LABEL}: [400-500 words]`;
		expect(parseActPlotTargetWordCount(actPlot)).toBe(450);
	});

	it('parses 300-500 to 400', () => {
		const actPlot = `- ${LABEL}: 300-500`;
		expect(parseActPlotTargetWordCount(actPlot)).toBe(400);
	});

	it('rounds midpoint to nearest 50 (325-375 -> 350)', () => {
		const actPlot = `- ${LABEL}: 325-375`;
		expect(parseActPlotTargetWordCount(actPlot)).toBe(350);
	});

	it('rounds midpoint down when ties favour nearest even multiple', () => {
		// 400-405 -> midpoint 402.5 -> rounds to 400
		const actPlot = `- ${LABEL}: 400-405`;
		expect(parseActPlotTargetWordCount(actPlot)).toBe(400);
	});

	it('parses ranges with non-dash separators (e.g. "300 to 500")', () => {
		const actPlot = `- ${LABEL}: 300 to 500 words`;
		expect(parseActPlotTargetWordCount(actPlot)).toBe(400);
	});

	it('parses the localized zh-Hant-HK label', () => {
		const zhLabel = '每場景目標字數';
		lsMock.mockImplementation((key: string) => (key === 'common.headers.targetWordCountPerScene' ? zhLabel : key));
		const actPlot = `- **${zhLabel}:** [400-500 字]`;
		expect(parseActPlotTargetWordCount(actPlot)).toBe(450);
	});

	it('matches case-insensitively against the label', () => {
		const actPlot = `- target word count per scene: 300-500`;
		expect(parseActPlotTargetWordCount(actPlot)).toBe(400);
	});

	it('returns null for out-of-range bounds', () => {
		// 5 and 10 are both below MIN_PARSED_BOUND (10).
		expect(parseActPlotTargetWordCount(`- ${LABEL}: 5-10`)).toBeNull();
		// 5001 is above MAX_PARSED_BOUND (5000).
		expect(parseActPlotTargetWordCount(`- ${LABEL}: 100-5001`)).toBeNull();
	});

	it('accepts values at the boundary (lower=10, upper=5000)', () => {
		expect(parseActPlotTargetWordCount(`- ${LABEL}: 10-5000`)).toBe(2500);
	});

	it('returns null when lower bound exceeds upper bound', () => {
		expect(parseActPlotTargetWordCount(`- ${LABEL}: 500-300`)).toBeNull();
	});

	it('uses only the first two integers on the label line', () => {
		// First two integers are 300 and 500 -> 400, ignoring trailing 700.
		const actPlot = `- ${LABEL}: 300-500 words (max 700)`;
		expect(parseActPlotTargetWordCount(actPlot)).toBe(400);
	});

	it('uses the first matching line when multiple lines contain the label', () => {
		const actPlot = `- ${LABEL}: 300-500\n- ${LABEL}: 700-900`;
		expect(parseActPlotTargetWordCount(actPlot)).toBe(400);
	});

	it('handles CRLF line endings', () => {
		const actPlot = `- ${LABEL}: 300-500\r\n## Premise`;
		expect(parseActPlotTargetWordCount(actPlot)).toBe(400);
	});

	it('parses real act plot with the line embedded among other content (markdown bold label)', () => {
		const actPlot = [
			'# Act Plot',
			'',
			'## Story Structure',
			'',
			'- **Target Scenes:** [35-50 scenes recommended]',
			`- **${LABEL}:** [400-500 words]`,
			'- **Estimated Total Words:** [14,000-25,000 words]',
			'',
			'## Premise',
			'',
			'Some premise text.',
		].join('\n');
		// Verifies the parser matches the per-scene label line (which contains 400-500)
		// and does NOT accidentally match the unrelated integer-bearing lines for
		// Target Scenes (35-50) or Estimated Total Words (14,000-25,000).
		expect(parseActPlotTargetWordCount(actPlot)).toBe(450);
	});
});
