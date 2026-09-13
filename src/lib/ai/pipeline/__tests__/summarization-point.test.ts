import { describe, it, expect } from 'vitest';
import { resolveSummarizationPoint } from '../summarization-point';

describe('resolveSummarizationPoint', () => {
	it('floors to the latest interval multiple at or below the current scene', () => {
		// SP is the last scene folded into the frozen summary; scenes after it stay raw.
		expect(resolveSummarizationPoint(15, 10)).toBe(10);
		expect(resolveSummarizationPoint(9, 8)).toBe(8);
	});

	it('returns the exact multiple when the current scene lands on it', () => {
		expect(resolveSummarizationPoint(16, 8)).toBe(16);
		expect(resolveSummarizationPoint(8, 8)).toBe(8);
	});

	it('returns 0 before the first interval completes (no SP yet ⇒ no Summaries message)', () => {
		expect(resolveSummarizationPoint(7, 8)).toBe(0);
		expect(resolveSummarizationPoint(1, 8)).toBe(0);
	});

	it('returns 0 when disabled (interval <= 0)', () => {
		expect(resolveSummarizationPoint(15, 0)).toBe(0);
		expect(resolveSummarizationPoint(15, -1)).toBe(0);
	});
});
