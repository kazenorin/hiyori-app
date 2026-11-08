import type { IconName } from '#lib/ui/icons.ts';

export type ContextKey = 'storySoFar' | 'scenePlot' | 'characterProfiles';

/** Icon per editable context, mirroring PHASE_ICONS in PhaseStrip.svelte. */
export const CONTEXT_ICONS: Record<ContextKey, IconName> = {
	storySoFar: 'book-open-text',
	scenePlot: 'compass',
	characterProfiles: 'users',
};

export const CONTEXT_LABEL_KEYS: Record<ContextKey, string> = {
	storySoFar: 'chat.context.storySoFar',
	scenePlot: 'chat.context.scenePlot',
	characterProfiles: 'chat.context.characterProfiles',
};
