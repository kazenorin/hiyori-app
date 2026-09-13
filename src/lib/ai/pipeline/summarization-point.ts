/**
 * Resolve the summarization point (SP): the last scene number included in the
 * frozen Summaries snapshot (Act Summary + Character Profiles). Scenes after the
 * SP are injected raw and append-only, so the shared prefix stays byte-stable
 * across turns within an interval.
 *
 * `sp = floor(currentScene / interval) * interval`. Returns 0 when the interval is
 * disabled (<= 0) or no full interval has completed yet — callers then omit the
 * Summaries message and start Scenes from the act's first scene.
 *
 * Deterministic and derived per run (from `completedScenes` + the interval
 * setting), so a resumed run recomputes an identical prefix.
 */
export function resolveSummarizationPoint(currentScene: number, interval: number): number {
	if (interval <= 0) return 0;
	return Math.floor(currentScene / interval) * interval;
}
