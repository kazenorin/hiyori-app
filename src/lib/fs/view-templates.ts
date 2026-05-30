import { LocalizedViewTemplateFile, registerDefaults, SUPPORTED_LOCALES } from './prompt-loader';
import type { SupportedLocale } from './prompt-loader';
import { registerBundledContent } from './config-manifest';

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

for (const locale of SUPPORTED_LOCALES) {
	for (const [globKey, content] of Object.entries(viewTemplateDefaults[locale])) {
		const normalizedKey = globKey.replace(/^\.\//, '');
		const relFromViewTemplates = normalizedKey.replace(/^.*?view-templates\//, '');
		const configPath = `${locale}/view-templates/${relFromViewTemplates}`;
		registerBundledContent(configPath, content);
	}
}

const storyMessageTemplatePrompt = new LocalizedViewTemplateFile(viewTemplateDefaults, 'story-message-template.md');

registerDefaults([storyMessageTemplatePrompt]);

export function loadStoryMessageTemplate(): Promise<string> {
	return storyMessageTemplatePrompt.load();
}

export function loadStoryMessageTemplateForStory(storyId: string, storyName: string): Promise<string> {
	return storyMessageTemplatePrompt.loadForStory(storyId, storyName);
}
