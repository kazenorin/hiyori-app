import { ls } from '$lib/localization';
import type { PromptLoader } from '$lib/fs/prompts';
import {
	highFantasyTemplateLoader,
	modernSliceOfLifeTemplateLoader,
	sciFiTemplateLoader,
	urbanFantasyTemplateLoader,
} from '$lib/fs/prompts';

export interface WorldTemplateEntry {
	id: string;
	label: () => string;
	loader: PromptLoader;
}

export const WORLD_TEMPLATES: WorldTemplateEntry[] = [
	{
		id: 'high-fantasy',
		label: () => ls('features.worldBuilder.templates.highFantasy'),
		loader: highFantasyTemplateLoader,
	},
	{
		id: 'modern-slice-of-life',
		label: () => ls('features.worldBuilder.templates.modernSliceOfLife'),
		loader: modernSliceOfLifeTemplateLoader,
	},
	{
		id: 'sci-fi',
		label: () => ls('features.worldBuilder.templates.sciFi'),
		loader: sciFiTemplateLoader,
	},
	{
		id: 'urban-fantasy',
		label: () => ls('features.worldBuilder.templates.urbanFantasy'),
		loader: urbanFantasyTemplateLoader,
	},
];
