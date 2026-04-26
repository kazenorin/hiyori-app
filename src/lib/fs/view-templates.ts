import { Prompt, registerDefaults, loadViewTemplate, loadViewTemplateForStory } from './prompt-loader';
import storyMessageTemplate from './view-templates/story-message-template.md?raw';

const STORY_MESSAGE_TEMPLATE_PATH = 'story-message-template.md';

const storyMessageTemplatePrompt = new Prompt({
	relativePath: STORY_MESSAGE_TEMPLATE_PATH,
	defaultContent: storyMessageTemplate,
	baseDir: 'config/view-templates',
});

registerDefaults([storyMessageTemplatePrompt]);

export function loadStoryMessageTemplate(): Promise<string> {
	return loadViewTemplate(STORY_MESSAGE_TEMPLATE_PATH, storyMessageTemplate);
}

export function loadStoryMessageTemplateForStory(storyId: string, storyName: string): Promise<string> {
	return loadViewTemplateForStory(storyId, storyName, STORY_MESSAGE_TEMPLATE_PATH, storyMessageTemplate);
}
