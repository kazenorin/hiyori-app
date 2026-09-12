import type { PhaseMetadata } from '../chat-stream';

export interface PhaseCacheMetric {
	phaseName: string;
	model: string;
	inputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	/** cacheReadTokens / inputTokens; 0 when inputTokens is 0. */
	cacheReadRatio: number;
}

export interface CacheEfficiencySummary {
	totalInputTokens: number;
	totalCacheReadTokens: number;
	totalCacheWriteTokens: number;
	/** totalCacheReadTokens / totalInputTokens; 0 when totalInputTokens is 0. */
	overallCacheReadRatio: number;
	phases: PhaseCacheMetric[];
}

function ratio(read: number, input: number): number {
	return input > 0 ? read / input : 0;
}

/**
 * Aggregate per-phase token metadata into a cache-efficiency summary.
 * `cacheReadTokens` / `cacheWriteTokens` are optional on PhaseMetadata (providers
 * that do not report caching omit them) and are treated as 0.
 *
 * NOTE: ratio semantics are provider-dependent — OpenAI-style reports cached tokens
 * as a subset of inputTokens, Anthropic-style reports them separately. The raw
 * totals are the ground truth; treat the ratio as an indicative signal.
 */
export function summarizeCacheEfficiency(phases: PhaseMetadata[]): CacheEfficiencySummary {
	const mapped: PhaseCacheMetric[] = phases.map((p) => {
		const cacheReadTokens = p.cacheReadTokens ?? 0;
		const cacheWriteTokens = p.cacheWriteTokens ?? 0;
		return {
			phaseName: p.phaseName,
			model: p.model,
			inputTokens: p.inputTokens,
			cacheReadTokens,
			cacheWriteTokens,
			cacheReadRatio: ratio(cacheReadTokens, p.inputTokens),
		};
	});

	const totalInputTokens = mapped.reduce((sum, p) => sum + p.inputTokens, 0);
	const totalCacheReadTokens = mapped.reduce((sum, p) => sum + p.cacheReadTokens, 0);
	const totalCacheWriteTokens = mapped.reduce((sum, p) => sum + p.cacheWriteTokens, 0);

	return {
		totalInputTokens,
		totalCacheReadTokens,
		totalCacheWriteTokens,
		overallCacheReadRatio: ratio(totalCacheReadTokens, totalInputTokens),
		phases: mapped,
	};
}

/** Render a summary as a compact multi-line report for the debug log. */
export function formatCacheEfficiency(summary: CacheEfficiencySummary): string {
	const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
	const lines = [
		`turn totals: input=${summary.totalInputTokens} cacheRead=${summary.totalCacheReadTokens} cacheWrite=${summary.totalCacheWriteTokens} readRatio=${pct(summary.overallCacheReadRatio)}`,
	];
	for (const p of summary.phases) {
		lines.push(
			`  ${p.phaseName} [${p.model}]: input=${p.inputTokens} cacheRead=${p.cacheReadTokens} cacheWrite=${p.cacheWriteTokens} readRatio=${pct(p.cacheReadRatio)}`
		);
	}
	return lines.join('\n');
}
