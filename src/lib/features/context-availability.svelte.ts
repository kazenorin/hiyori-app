import { getActByActLineId } from '#lib/db/acts';
import type { ContextKey } from '#lib/components/chat/context/context-registry';
import { SvelteMap } from 'svelte/reactivity';

let available = $state<ContextKey[]>([]);
const continuedCache = new SvelteMap<string, boolean>();

/**
 * Availability is act-line-scoped, not message-scoped: computed once and passed to every PhaseStrip.
 * All three inputs are synchronous reads at the call site so the driving $effect tracks them; the
 * async lookup happens after the await and is deliberately not tracked.
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
	available = contexts;
}

export function getAvailableContexts(): ContextKey[] {
	return available;
}
