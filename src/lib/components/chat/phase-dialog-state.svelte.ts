import type { PhaseName } from '$lib/ai/narrative-types';

let isOpen = $state(false);
let messageId = $state<string | null>(null);
let activePhase = $state<PhaseName | null>(null);

export function openPhaseDialog(id: string, phase: PhaseName): void {
	messageId = id;
	activePhase = phase;
	isOpen = true;
}

export function closePhaseDialog(): void {
	isOpen = false;
}

export function getPhaseDialogOpen(): boolean {
	return isOpen;
}

export function getPhaseDialogMessageId(): string | null {
	return messageId;
}

export function getPhaseDialogPhase(): PhaseName | null {
	return activePhase;
}

export function setPhaseDialogPhase(phase: PhaseName): void {
	activePhase = phase;
}
