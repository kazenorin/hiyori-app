import type { Component } from 'svelte';
import { Palette, Plug, Users, BookOpen, Sparkles, AudioLines, CloudUpload, Brain, Database, Bug } from '@lucide/svelte';
import type { SectionId } from './settings-dialog-state.svelte';
import { isMemoryCapable } from '$lib/stores/settings.svelte';
import GeneralSection from './sections/GeneralSection.svelte';
import ProvidersSection from './sections/ProvidersSection.svelte';
import RolesSection from './sections/RolesSection.svelte';
import NarrativeSection from './sections/NarrativeSection.svelte';
import CharacterNamesSection from './sections/CharacterNamesSection.svelte';
import TtsSection from './sections/TtsSection.svelte';
import CloudSyncSection from './sections/CloudSyncSection.svelte';
import MemorySection from './sections/MemorySection.svelte';
import DataSection from './sections/DataSection.svelte';
import DeveloperSection from './sections/DeveloperSection.svelte';

export interface SettingsSection {
	id: SectionId;
	labelKey: string;
	descriptionKey?: string;
	icon: Component;
	component: Component;
	visible?: () => boolean;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
	{
		id: 'general',
		labelKey: 'settings.section.general',
		descriptionKey: 'settings.appearanceDescription',
		icon: Palette,
		component: GeneralSection,
	},
	{ id: 'providers', labelKey: 'settings.aiProviders', icon: Plug, component: ProvidersSection },
	{
		id: 'roles',
		labelKey: 'settings.section.roles',
		descriptionKey: 'settings.providerRolesDescription',
		icon: Users,
		component: RolesSection,
	},
	{ id: 'narrative', labelKey: 'settings.narrative', icon: BookOpen, component: NarrativeSection },
	{
		id: 'characterNames',
		labelKey: 'settings.section.characterNames',
		icon: Sparkles,
		component: CharacterNamesSection,
	},
	{ id: 'tts', labelKey: 'tts.tts', descriptionKey: 'tts.ttsDescription', icon: AudioLines, component: TtsSection },
	{
		id: 'cloudSync',
		labelKey: 'cloudSync.title',
		descriptionKey: 'cloudSync.description',
		icon: CloudUpload,
		component: CloudSyncSection,
	},
	{
		id: 'memory',
		labelKey: 'settings.memory',
		descriptionKey: 'settings.enableMemoryDescription',
		icon: Brain,
		component: MemorySection,
		visible: () => isMemoryCapable(),
	},
	{ id: 'data', labelKey: 'settings.data', descriptionKey: 'settings.dataDescription', icon: Database, component: DataSection },
	{ id: 'developer', labelKey: 'settings.developer', icon: Bug, component: DeveloperSection },
];

export function getVisibleSections(): SettingsSection[] {
	return SETTINGS_SECTIONS.filter((s) => !s.visible || s.visible());
}
