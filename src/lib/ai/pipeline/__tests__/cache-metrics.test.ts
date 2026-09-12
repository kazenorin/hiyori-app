import { describe, it, expect } from 'vitest';
import { summarizeCacheEfficiency, formatCacheEfficiency } from '../cache-metrics';
import type { PhaseMetadata } from '../../chat-stream';

function phase(overrides: Partial<PhaseMetadata> = {}): PhaseMetadata {
	return {
		phaseName: 'WRITER',
		model: 'test-model',
		finishReason: 'stop',
		inputTokens: 1000,
		outputTokens: 200,
		totalTokens: 1200,
		durationMs: 10,
		...overrides,
	};
}

describe('summarizeCacheEfficiency', () => {
	it('returns a zeroed summary (no NaN) for empty input', () => {
		const s = summarizeCacheEfficiency([]);
		expect(s.totalInputTokens).toBe(0);
		expect(s.totalCacheReadTokens).toBe(0);
		expect(s.overallCacheReadRatio).toBe(0);
		expect(s.phases).toEqual([]);
	});

	it('treats missing cache tokens as zero and guards a zero-input ratio', () => {
		const s = summarizeCacheEfficiency([phase({ inputTokens: 0 })]);
		expect(s.phases[0].cacheReadTokens).toBe(0);
		expect(s.phases[0].cacheReadRatio).toBe(0);
	});

	it('sums tokens across phases and computes per-phase + overall read ratios', () => {
		const s = summarizeCacheEfficiency([
			phase({ phaseName: 'WRITER', inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 800 }),
			phase({ phaseName: 'EDITOR', inputTokens: 1000, cacheReadTokens: 800 }),
		]);
		expect(s.totalInputTokens).toBe(2000);
		expect(s.totalCacheReadTokens).toBe(800);
		expect(s.totalCacheWriteTokens).toBe(800);
		expect(s.overallCacheReadRatio).toBeCloseTo(0.4);
		expect(s.phases[1].cacheReadRatio).toBeCloseTo(0.8);
	});
});

describe('formatCacheEfficiency', () => {
	it('renders turn totals and one indented line per phase', () => {
		const text = formatCacheEfficiency(
			summarizeCacheEfficiency([
				phase({ phaseName: 'WRITER', inputTokens: 1000, cacheReadTokens: 400 }),
				phase({ phaseName: 'EDITOR', inputTokens: 1000, cacheReadTokens: 800 }),
			])
		);
		const lines = text.split('\n');
		expect(lines).toHaveLength(3);
		expect(lines[0]).toContain('turn totals');
		expect(lines[1]).toContain('WRITER');
		expect(lines[1]).toContain('input=1000');
		expect(lines[1]).toContain('cacheRead=400');
		expect(lines[2]).toMatch(/^\s{2}EDITOR/);
	});

	it('renders only the turn-totals line when there are no phases', () => {
		const text = formatCacheEfficiency(summarizeCacheEfficiency([]));
		expect(text.split('\n')).toHaveLength(1);
		expect(text).toContain('turn totals');
	});
});
