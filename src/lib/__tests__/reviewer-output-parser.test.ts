import { describe, it, expect } from 'vitest';
import { reviewerAcceptsAsIs } from '$lib/ai/reviewer-output-parser';

describe('reviewerAcceptsAsIs', () => {
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

	it('handles Summary items in paragraph form', () => {
		const output = `# Review Output

## Summary
Total violations: 0. Recommendation: accept as-is.`;

		expect(reviewerAcceptsAsIs(output)).toBe(true);
	});
});
