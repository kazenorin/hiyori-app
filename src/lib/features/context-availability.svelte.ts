import { getActByActLineId } from '#lib/db/acts.ts';
import type { ContextKey } from '#lib/components/chat/context/context-registry.ts';
import { SvelteMap } from 'svelte/reactivity';

let available = $state<ContextKey[]>([]);
// SvelteMap, not Map: eslint's svelte/prefer-svelte-reactivity rejects a plain Map in a .svelte.ts
// file. Precedent: load-story-state.svelte.ts. The reactive read costs one extra idempotent
// $effect re-run per newly seen act-line id (cache hit on the second pass, so it settles).
const continuedCache = new SvelteMap<string, boolean>();

/**
 * Availability is act-line-scoped, not message-scoped: computed once and passed to every PhaseStrip.
 * All three inputs are synchronous reads at the call site so the driving $effect tracks them; the
 * pre-await continuedCache.get(...) read is tracked too, and only the post-await DB lookup is not.
 */
export async function refreshAvailableContexts(actLineId: string | null, plannerEnabled: boolean, hasScenePlots: boolean): Promise<void> {
	let continued = false;
	if (actLineId !== null) {
		const cached = continuedCache.get(actLineId);
		if (cached !== undefined) {
			continued = cached;
		} else {
			const act = await getActByActLineId(actLineId);
			continued = act?.continuesFromActLineId != null;
			continuedCache.set(actLineId, continued);
		}
	}

	const contexts: ContextKey[] = [];
	if (continued) contexts.push('storySoFar');
	if (actLineId !== null && (plannerEnabled || hasScenePlots)) contexts.push('scenePlot');
	// Profiles are readable and addable at any scene, even before one exists, so the panel stays
	// reachable with an empty collection.
	if (actLineId !== null) contexts.push('characterProfiles');
	available = contexts;
}

export function getAvailableContexts(): ContextKey[] {
	return available;
}
