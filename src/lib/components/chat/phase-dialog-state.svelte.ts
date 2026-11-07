import type { PhaseName } from '#lib/ai/narrative-types';
import type { ContextKey } from '#lib/components/chat/context/context-registry';
import { mobileFeatures } from '#lib/stores/mobile-nav.svelte';

export type PhaseDialogSelection = { kind: 'phase'; phase: PhaseName } | { kind: 'context'; context: ContextKey };

let isOpen = $state(false);
let messageId = $state<string | null>(null);
let selection = $state<PhaseDialogSelection>({ kind: 'phase', phase: 'WRITER' });

let isContextOpen = $state(false);
let contextMessageId = $state<string | null>(null);
let contextSelection = $state<ContextKey>('storySoFar');

export function openPhaseDialog(id: string, phase: PhaseName): void {
	messageId = id;
	selection = { kind: 'phase', phase };
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

export function getPhaseDialogSelection(): PhaseDialogSelection {
	return selection;
}

export function setPhaseDialogSelection(next: PhaseDialogSelection): void {
	selection = next;
}

/** Wide: share the phase dialog. Narrow: the phase dialog cannot show context, so use the dedicated one. */
export function openContext(id: string, context: ContextKey): void {
	if (mobileFeatures.isPhone) {
		openContextDialog(id, context);
		return;
	}
	messageId = id;
	selection = { kind: 'context', context };
	isOpen = true;
}

export function openContextDialog(id: string, context: ContextKey): void {
	contextMessageId = id;
	contextSelection = context;
	isContextOpen = true;
}

export function closeContextDialog(): void {
	isContextOpen = false;
}

export function getContextDialogOpen(): boolean {
	return isContextOpen;
}

export function getContextDialogMessageId(): string | null {
	return contextMessageId;
}

export function getContextDialogSelection(): ContextKey {
	return contextSelection;
}

export function setContextDialogSelection(context: ContextKey): void {
	contextSelection = context;
}
