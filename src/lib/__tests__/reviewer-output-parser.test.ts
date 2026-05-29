import { describe, it, expect, vi, afterEach } from 'vitest';

const mockTotalViolationsLabel = vi.fn(() => 'Total violations');
const mockRecommendationLabel = vi.fn(() => 'Recommendation');
const mockAcceptAsIsLabel = vi.fn(() => 'accept as-is');
const mockSummaryHeader = vi.fn(() => 'Summary');

vi.mock('$lib/definitions/pipeline-prompts', () => ({
	totalViolationsLabel: () => mockTotalViolationsLabel(),
	recommendationLabel: () => mockRecommendationLabel(),
	acceptAsIsLabel: () => mockAcceptAsIsLabel(),
}));

vi.mock('$lib/definitions/common-headers', () => ({
	summaryHeader: () => mockSummaryHeader(),
}));

vi.mock('$lib/logging/logger', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {}),
	},
	fileLog: vi.fn(async () => {}),
}));

import { reviewerAcceptsAsIs } from '$lib/ai/reviewer-output-parser';

describe('reviewerAcceptsAsIs', () => {
	afterEach(() => {
		mockTotalViolationsLabel.mockReturnValue('Total violations');
		mockRecommendationLabel.mockReturnValue('Recommendation');
		mockAcceptAsIsLabel.mockReturnValue('accept as-is');
		mockSummaryHeader.mockReturnValue('Summary');
	});

	it('returns true for valid accept-as-is output', () => {
		const output = `# Review Output

## Violations
None.

## Summary
- Total violations: 0
- Severity: none
- Recommendation: accept as-is`;

		expect(reviewerAcceptsAsIs(output)).toBe(true);
	});

	it('returns true with case-insensitive matching', () => {
		const output = `# Review Output

## Summary
- Total Violations: 0
- Recommendation: Accept As-Is`;

		expect(reviewerAcceptsAsIs(output)).toBe(true);
	});

	it('returns false when violations > 0', () => {
		const output = `# Review Output

## Violations
- Rule 1 Violation: something wrong

## Summary
- Total violations: 1
- Severity: low
- Recommendation: minor edits needed`;

		expect(reviewerAcceptsAsIs(output)).toBe(false);
	});

	it('returns false when recommendation is not accept-as-is', () => {
		const output = `# Review Output

## Summary
- Total violations: 0
- Recommendation: minor edits needed`;

		expect(reviewerAcceptsAsIs(output)).toBe(false);
	});

	it('returns false for undefined input', () => {
		expect(reviewerAcceptsAsIs(undefined)).toBe(false);
	});

	it('returns false for empty string', () => {
		expect(reviewerAcceptsAsIs('')).toBe(false);
	});

	it('returns false when no Summary section exists', () => {
		const output = `# Review Output

## Violations
None.`;

		expect(reviewerAcceptsAsIs(output)).toBe(false);
	});

	it('does not match accept-as-is outside Summary section', () => {
		const output = `# Review Output

## Violations
The reviewer should not accept as-is because there are issues.

## Summary
- Total violations: 2
- Recommendation: major revision needed`;

		expect(reviewerAcceptsAsIs(output)).toBe(false);
	});

	it('returns true for Chinese locale output', () => {
		mockTotalViolationsLabel.mockReturnValue('違規總數');
		mockRecommendationLabel.mockReturnValue('建議');
		mockAcceptAsIsLabel.mockReturnValue('不需修改');
		mockSummaryHeader.mockReturnValue('摘要');

		const output = `# 審查結果

## 違規
無。

## 摘要
- 違規總數: 0
- 嚴重程度: 無
- 建議: 不需修改`;

		expect(reviewerAcceptsAsIs(output)).toBe(true);
	});

	it('strips code fences before parsing', () => {
		const output = `\`\`\`markdown
# Review Output

## Violations
None.

## Summary
- Total violations: 0
- Severity: none
- Recommendation: accept as-is
\`\`\``;

		expect(reviewerAcceptsAsIs(output)).toBe(true);
	});
});
