export type SectionId =
	| 'general'
	| 'catalogProviders'
	| 'providers'
	| 'roles'
	| 'narrative'
	| 'characterNames'
	| 'tts'
	| 'cloudSync'
	| 'memory'
	| 'data'
	| 'developer';

// The catalog-backed AI Providers section is the landing section: it's the most
// important setting (nothing works without a provider), even though General lists first.
export const DEFAULT_SECTION: SectionId = 'catalogProviders';

let isOpen = $state(false);
let activeSection = $state<SectionId>(DEFAULT_SECTION);

export function openSettingsDialog(section?: SectionId): void {
	if (section) activeSection = section;
	isOpen = true;
}

export function closeSettingsDialog(): void {
	isOpen = false;
}

export function isSettingsDialogOpen(): boolean {
	return isOpen;
}

export function getActiveSection(): SectionId {
	return activeSection;
}

export function setActiveSection(section: SectionId): void {
	activeSection = section;
}
