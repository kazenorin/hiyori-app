import type { ToolSet } from 'ai';

/** Tools with side effects that must be gated to specific phases (read-only tools are not listed). */
export const SIDE_EFFECTING_TOOLS: ReadonlySet<string> = new Set([
	'introduce-character',
	'update-inventory',
	'update-character-profile',
	'advance-phase',
	'end-act',
	'set-scene-title',
]);

/**
 * Return a phase-scoped view of `allTools` where side-effecting tools not in `allowed`
 * have their `execute` swapped for a benign `noOp`. `description` + `inputSchema` are
 * preserved (spread), so the serialized schema sent to the model is byte-identical across
 * phases — keeping the tool block inside the cacheable prefix. Read-only tools and allowed
 * side-effecting tools pass through by reference, so their internal state guards (e.g.
 * advance-phase's `hasAdvancedPhase`) run unchanged. With `strict`, every tool outside
 * `allowed` no-ops instead — read-only included — for background phases that must not call any
 * tool. Pure: no DB/settings/locale imports.
 */
export function withPhaseGuards(
	allTools: ToolSet,
	allowed: readonly string[],
	noOp: (toolName: string) => unknown,
	strict = false
): ToolSet {
	const allowedSet = new Set(allowed);
	const guarded: ToolSet = {};
	for (const [name, t] of Object.entries(allTools)) {
		if (allowedSet.has(name) || (!strict && !SIDE_EFFECTING_TOOLS.has(name))) {
			guarded[name] = t;
			continue;
		}
		guarded[name] = { ...t, execute: (async () => noOp(name)) as typeof t.execute };
	}
	return guarded;
}
