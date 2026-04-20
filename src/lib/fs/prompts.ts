// Unified prompt loading module
// Replaces: system-prompt.ts, narration-template.ts, world-prompts.ts, act-card-prompts.ts, character-card-prompts.ts

import { Prompt, loadPromptForStory, registerDefaults } from './prompt-loader';
import { settings } from '$lib/stores/settings.svelte';

// === Bundled Default Imports ===

// System & Narration
import defaultSystemPrompt from './prompts/system-prompt.md?raw';
import defaultNarrationExtractionPrompt from './prompts/narration-extraction-prompt.md?raw';
import defaultNarrationTemplate from './prompts/narration-template.md?raw';

// World
import defaultWorldTemplate from './prompts/world/world-template.md?raw';
import defaultGenerateWorldFromChatPrompt from './prompts/world/generate-world-from-chat-prompt.md?raw';
import defaultGenerateWorldFromChatSystemPrompt from './prompts/world/generate-world-from-chat-system-prompt.md?raw';
import defaultWorldBuilderSystemPrompt from './prompts/world/world-builder-system-prompt.md?raw';

// Act
import defaultActCardTemplate from './prompts/act/act-card-template.md?raw';
import defaultActExtractionPrompt from './prompts/act/act-extraction-prompt.md?raw';
import defaultActPlotTemplate from './prompts/act/act-plot-template.md?raw';
import defaultActPlotGenerationPrompt from './prompts/act/act-plot-generation-prompt.md?raw';

// Character
import defaultCharacterCardTemplate from './prompts/character/character-card-template.md?raw';
import defaultCharacterCardExtractionPrompt from './prompts/character/character-card-extraction-prompt.md?raw';
import defaultCharacterCardExtractionSystemPrompt from './prompts/character/character-card-extraction-system-prompt.md?raw';
import defaultSummarizeCharactersInAct from './prompts/character/summarize-characters-in-act.md?raw';

// Import
import defaultActGenerationPrompt from './prompts/import/act-generation-prompt.md?raw';
import defaultChoicesExtractionPrompt from './prompts/import/choices-extraction-prompt.md?raw';

// Memories
import defaultMemoryExtractionSystemPrompt from './prompts/memories/memory-extraction-system-prompt.md?raw';
import defaultMemoryExtractionPrompt from './prompts/memories/memory-extraction-prompt.md?raw';

// Reviewer
import defaultEditorModeExtractionPrompt from './prompts/reviewer/editor-mode-extraction-prompt.md?raw';
import defaultTriggerEditorModeFragment from './prompts/reviewer/trigger-editor-mode-fragment.md?raw';

// Re-export for consumers that need raw content
export {
	defaultSystemPrompt,
	defaultNarrationExtractionPrompt,
	defaultNarrationTemplate,
	defaultWorldTemplate,
	defaultGenerateWorldFromChatPrompt,
	defaultGenerateWorldFromChatSystemPrompt,
	defaultWorldBuilderSystemPrompt,
	defaultActCardTemplate,
	defaultActExtractionPrompt,
	defaultActPlotTemplate,
	defaultActPlotGenerationPrompt,
	defaultCharacterCardTemplate,
	defaultCharacterCardExtractionPrompt,
	defaultCharacterCardExtractionSystemPrompt,
	defaultSummarizeCharactersInAct,
	defaultActGenerationPrompt,
	defaultChoicesExtractionPrompt,
	defaultMemoryExtractionSystemPrompt,
	defaultMemoryExtractionPrompt,
	defaultEditorModeExtractionPrompt,
	defaultTriggerEditorModeFragment,
};

// === Prompt Config Instances ===

// System & Narration
const systemPrompt = new Prompt({ relativePath: 'system-prompt.md', defaultContent: defaultSystemPrompt });
const narrationExtractionPrompt = new Prompt({
	relativePath: 'narration-extraction-prompt.md',
	defaultContent: defaultNarrationExtractionPrompt,
});
const narrationTemplate = new Prompt({
	relativePath: 'narration-template.md',
	defaultContent: defaultNarrationTemplate,
});

// World
const worldTemplate = new Prompt({ relativePath: 'world/world-template.md', defaultContent: defaultWorldTemplate });
const generateWorldFromChatPrompt = new Prompt({
	relativePath: 'world/generate-world-from-chat-prompt.md',
	defaultContent: defaultGenerateWorldFromChatPrompt,
});
const generateWorldFromChatSystemPrompt = new Prompt({
	relativePath: 'world/generate-world-from-chat-system-prompt.md',
	defaultContent: defaultGenerateWorldFromChatSystemPrompt,
});
const worldBuilderSystemPrompt = new Prompt({
	relativePath: 'world/world-builder-system-prompt.md',
	defaultContent: defaultWorldBuilderSystemPrompt,
});

// Act
const actCardTemplate = new Prompt({
	relativePath: 'act/act-card-template.md',
	defaultContent: defaultActCardTemplate,
});
const actExtractionPrompt = new Prompt({
	relativePath: 'act/act-extraction-prompt.md',
	defaultContent: defaultActExtractionPrompt,
});
const actPlotTemplate = new Prompt({
	relativePath: 'act/act-plot-template.md',
	defaultContent: defaultActPlotTemplate,
});
const actPlotGenerationPrompt = new Prompt({
	relativePath: 'act/act-plot-generation-prompt.md',
	defaultContent: defaultActPlotGenerationPrompt,
});

// Character
const characterCardTemplate = new Prompt({
	relativePath: 'character/character-card-template.md',
	defaultContent: defaultCharacterCardTemplate,
});
const characterCardExtractionPrompt = new Prompt({
	relativePath: 'character/character-card-extraction-prompt.md',
	defaultContent: defaultCharacterCardExtractionPrompt,
});
const characterCardExtractionSystemPrompt = new Prompt({
	relativePath: 'character/character-card-extraction-system-prompt.md',
	defaultContent: defaultCharacterCardExtractionSystemPrompt,
});
const summarizeCharactersInAct = new Prompt({
	relativePath: 'character/summarize-characters-in-act.md',
	defaultContent: defaultSummarizeCharactersInAct,
});

// Import
const actGenerationPrompt = new Prompt({
	relativePath: 'import/act-generation-prompt.md',
	defaultContent: defaultActGenerationPrompt,
});
const choicesExtractionPrompt = new Prompt({
	relativePath: 'import/choices-extraction-prompt.md',
	defaultContent: defaultChoicesExtractionPrompt,
});

// Memories
const memoryExtractionSystemPrompt = new Prompt({
	relativePath: 'memories/memory-extraction-system-prompt.md',
	defaultContent: defaultMemoryExtractionSystemPrompt,
});
const memoryExtractionPrompt = new Prompt({
	relativePath: 'memories/memory-extraction-prompt.md',
	defaultContent: defaultMemoryExtractionPrompt,
});

// Reviewer
const editorModeExtractionPrompt = new Prompt({
	relativePath: 'reviewer/editor-mode-extraction-prompt.md',
	defaultContent: defaultEditorModeExtractionPrompt,
});
const triggerEditorModeFragment = new Prompt({
	relativePath: 'reviewer/trigger-editor-mode-fragment.md',
	defaultContent: defaultTriggerEditorModeFragment,
});

// === Load Functions ===

export const loadSystemPrompt = async (): Promise<string> => {
	if (settings.reviewerEnabled) {
		const [a, b] = await Promise.all([systemPrompt.load(), triggerEditorModeFragment.load()]);
		return a + b;
	} else {
		return systemPrompt.load();
	}
};
export const loadNarrationExtractionPrompt = (): Promise<string> => narrationExtractionPrompt.load();
export const loadNarrationTemplate = (): Promise<string> => narrationTemplate.load();
export async function loadNarrationContent(): Promise<string> {
	const [extraction, template] = await Promise.all([narrationExtractionPrompt.load(), narrationTemplate.load()]);
	return extraction.replace('{narrationTemplate}', template);
}
export const loadWorldTemplate = (): Promise<string> => worldTemplate.load();
export const loadGenerateWorldFromChatPrompt = (): Promise<string> => generateWorldFromChatPrompt.load();
export const loadGenerateWorldFromChatSystemPrompt = (): Promise<string> => generateWorldFromChatSystemPrompt.load();
export const loadWorldBuilderSystemPrompt = (): Promise<string> => worldBuilderSystemPrompt.load();
export const loadActCardTemplate = (): Promise<string> => actCardTemplate.load();
export const loadActExtractionPrompt = (): Promise<string> => actExtractionPrompt.load();
export const loadActPlotTemplate = (): Promise<string> => actPlotTemplate.load();
export const loadActPlotGenerationPrompt = (): Promise<string> => actPlotGenerationPrompt.load();
export const loadCharacterCardTemplate = (): Promise<string> => characterCardTemplate.load();
export const loadCharacterCardExtractionPrompt = (): Promise<string> => characterCardExtractionPrompt.load();
export const loadCharacterCardExtractionSystemPrompt = (): Promise<string> => characterCardExtractionSystemPrompt.load();
export const loadSummarizeCharactersInAct = (): Promise<string> => summarizeCharactersInAct.load();
export const loadActGenerationPrompt = (): Promise<string> => actGenerationPrompt.load();
export const loadChoicesExtractionPrompt = (): Promise<string> => choicesExtractionPrompt.load();
export const loadMemoryExtractionSystemPrompt = (): Promise<string> => memoryExtractionSystemPrompt.load();
export const loadMemoryExtractionPrompt = (): Promise<string> => memoryExtractionPrompt.load();
export const loadEditorModeExtractionPrompt = (): Promise<string> => editorModeExtractionPrompt.load();
export const loadTriggerEditorModeFragment = (): Promise<string> => triggerEditorModeFragment.load();

export const getDefaultSystemPromptContent = () => defaultSystemPrompt;
export const getDefaultNarrationExtractionPromptContent = () => defaultNarrationExtractionPrompt;
export const getDefaultNarrationTemplateContent = () => defaultNarrationTemplate;

// Story-specific loaders
export async function loadStorySystemPrompt(storyId: string, storyName: string): Promise<string> {
	if (settings.reviewerEnabled) {
		const [a, b] = await Promise.all([
			loadPromptForStory(storyId, storyName, systemPrompt.relativePath, systemPrompt.defaultContent),
			triggerEditorModeFragment.load(),
		]);
		return a + b;
	}
	return loadPromptForStory(storyId, storyName, systemPrompt.relativePath, systemPrompt.defaultContent);
}

export async function loadStoryNarrationExtractionPrompt(storyId: string, storyName: string): Promise<string> {
	return loadPromptForStory(storyId, storyName, narrationExtractionPrompt.relativePath, narrationExtractionPrompt.defaultContent);
}

export async function loadStoryNarrationTemplate(storyId: string, storyName: string): Promise<string> {
	return loadPromptForStory(storyId, storyName, narrationTemplate.relativePath, narrationTemplate.defaultContent);
}

export async function loadStoryNarrationContent(storyId: string, storyName: string): Promise<string> {
	const [extraction, template] = await Promise.all([
		loadStoryNarrationExtractionPrompt(storyId, storyName),
		loadStoryNarrationTemplate(storyId, storyName),
	]);
	return extraction.replace('{narrationTemplate}', template);
}

// === Ensure All Base Configs ===

export { ensureAllBaseConfigs } from './prompt-loader';

// Register all defaults so ensureAllBaseConfigs() can create them on launch
registerDefaults([
	systemPrompt,
	narrationTemplate,
	worldTemplate,
	generateWorldFromChatPrompt,
	generateWorldFromChatSystemPrompt,
	worldBuilderSystemPrompt,
	actCardTemplate,
	actExtractionPrompt,
	actPlotTemplate,
	actPlotGenerationPrompt,
	characterCardTemplate,
	characterCardExtractionPrompt,
	characterCardExtractionSystemPrompt,
	summarizeCharactersInAct,
	actGenerationPrompt,
	choicesExtractionPrompt,
	memoryExtractionSystemPrompt,
	memoryExtractionPrompt,
	editorModeExtractionPrompt,
	triggerEditorModeFragment,
]);
