import type { UIMessage } from '../chat/types';

/**
 * Resolve the summarization point (SP): the last scene number included in the frozen
 * Summaries snapshot. Scenes after the SP are injected raw and append-only, so the
 * shared prefix stays byte-stable across turns within an interval.
 *
 * The async Summarizer of the run for scene S+1 merges scene S and persists the
 * resulting summary (covering scenes 1..S) on the assistant message for scene S+1, so
 * a boundary's own snapshot only exists from the run after it. The SP is therefore one
 * full interval below the current boundary —
 * `floor(currentScene / interval) * interval - interval` — clamped to 0 until the
 * second summarization point (with interval 8: scenes 1-15 stay raw, runs 16-23
 * summarize 1-8, runs 24-31 summarize 1-16, ...). The extra clamp to
 * `currentScene - 2` keeps interval 1 from claiming coverage that no persisted
 * summary can have yet.
 *
 * Deterministic and derived per run (from `currentScene` + the interval setting), so
 * a resumed run recomputes an identical prefix.
 */
export function resolveSummarizationPoint(currentScene: number, interval: number): number {
	if (interval <= 0) return 0;
	const boundary = Math.floor(currentScene / interval) * interval;
	return Math.max(0, Math.min(boundary - interval, currentScene - 2));
}

export interface SummariesSnapshot {
	/** Scenes 1..summarizationPoint covered by the frozen snapshot; 0 when none resolved. */
	summarizationPoint: number;
	/** The frozen act summary text; empty when no snapshot resolved. */
	actSummaryAtSP: string;
	/** First scene number included in the raw Scenes message; 1 when no snapshot resolved. */
	scenesFromScene: number;
}

const NO_SUMMARIES: SummariesSnapshot = { summarizationPoint: 0, actSummaryAtSP: '', scenesFromScene: 1 };

/**
 * Resolve the frozen Summaries snapshot and the raw-Scenes window for a run. The
 * snapshot covering 1..SP is the act summary persisted on the assistant message for
 * scene SP+1 (see `resolveSummarizationPoint`), looked up by exact match: when that
 * message carries no summary (its run's async Summarizer failed or was aborted),
 * every scene stays raw instead of freezing an older snapshot whose coverage would
 * leave the scenes after it in a gap.
 */
export function resolveSummariesSnapshot(messages: UIMessage[], currentScene: number, interval: number): SummariesSnapshot {
	const sp = resolveSummarizationPoint(currentScene, interval);
	if (sp <= 0) return NO_SUMMARIES;
	// The player message for the scene being generated shares the last completed scene
	// number, so the scan must be scoped to assistant messages.
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== 'assistant' || m.sceneNumber !== sp + 1) continue;
		const summary = m.actSummary ?? '';
		return summary.trim().length > 0 ? { summarizationPoint: sp, actSummaryAtSP: summary, scenesFromScene: sp + 1 } : NO_SUMMARIES;
	}
	return NO_SUMMARIES;
}
