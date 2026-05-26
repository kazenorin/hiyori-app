import { LocalizedViewTemplateFile, registerDefaults } from './prompt-loader';
import type { SupportedLocale } from './prompt-loader';

const viewTemplateDefaults: Record<SupportedLocale, Record<string, string>> = {
	en: import.meta.glob('./en/view-templates/**/*.md', {
		eager: true,
		query: '?raw',
		import: 'default' as const,
	}) as Record<string, string>,
	'zh-Hant-HK': import.meta.glob('./zh-Hant-HK/view-templates/**/*.md', {
		eager: true,
		query: '?raw',
		import: 'default' as const,
	}) as Record<string, string>,
};

const storyMessageTemplatePrompt = new LocalizedViewTemplateFile(viewTemplateDefaults, 'story-message-template.md');

registerDefaults([storyMessageTemplatePrompt]);

export function loadStoryMessageTemplate(): Promise<string> {
	return storyMessageTemplatePrompt.load();
}

export function loadStoryMessageTemplateForStory(storyId: string, storyName: string): Promise<string> {
	return storyMessageTemplatePrompt.loadForStory(storyId, storyName);
}
