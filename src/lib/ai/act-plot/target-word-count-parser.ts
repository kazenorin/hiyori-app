import { ls } from '$lib/localization';

/** Minimum lower bound for the interview suggestion range (settings UI clamps at 50). */
const MIN_RANGE_LOWER = 50;
/** Sanity bounds for parsed per-scene values, guarding against incidental integers on the line. */
const MIN_PARSED_BOUND = 10;
const MAX_PARSED_BOUND = 5000;
/** Rounding granularity for the computed midpoint. */
const ROUND_TO = 50;

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compute the suggested per-scene word count range presented to the player
 * during the Act Plot interview. Lower bound is clamped at 50 so that a
 * settings value of 50 yields "50-150" (matching the minimum-range requirement).
 * For a settings value of 400, returns "300-500".
 */
export function computeTargetWordCountRange(targetWordCount: number): string {
	const lower = Math.max(MIN_RANGE_LOWER, targetWordCount - 100);
	const upper = targetWordCount + 100;
	return `${lower}-${upper}`;
}

/**
 * Parse the per-scene target word count from a generated act plot document.
 *
 * Locates the first line containing the localized "Target Word Count per Scene"
 * label, extracts the first two integers on that line, validates the bounds,
 * and returns the midpoint rounded to the nearest 50.
 *
 * Returns `null` on any parse failure, signalling the caller to fall back to
 * `settings.targetWordCount`.
 */
export function parseActPlotTargetWordCount(actPlot: string | null | undefined): number | null {
	if (!actPlot) return null;

	const label = ls('common.headers.targetWordCountPerScene');
	if (!label) return null;

	const labelRe = new RegExp(escapeRegex(label), 'i');
	const line = actPlot.split(/\r?\n/).find((l) => labelRe.test(l));
	if (!line) return null;

	const numbers = line.match(/\d+/g);
	if (!numbers || numbers.length < 2) return null;

	const lower = parseInt(numbers[0], 10);
	const upper = parseInt(numbers[1], 10);

	if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower < MIN_PARSED_BOUND || upper > MAX_PARSED_BOUND || lower > upper) {
		return null;
	}

	const midpoint = (lower + upper) / 2;
	return Math.round(midpoint / ROUND_TO) * ROUND_TO;
}
