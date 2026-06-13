import { getActiveActLineId, getActiveAct } from '$lib/stores/stories.svelte';
import { getIsBusy } from '$lib/ai/chat.svelte';

let regenerateChoiceIndex = $state<number | null>(null);

export function getRegenerateChoiceIndex(): number | null {
	return regenerateChoiceIndex;
}

export function handleRegenerateChoice(messageIndex: number): void {
	const actLineId = getActiveActLineId();
	const act = getActiveAct();
	if (!actLineId || !act || getIsBusy()) return;
	regenerateChoiceIndex = messageIndex;
}

export function cancelRegenerateChoice(): void {
	regenerateChoiceIndex = null;
}
