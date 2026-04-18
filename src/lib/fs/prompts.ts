// Unified prompt loading module
// Replaces: system-prompt.ts, narration-template.ts, world-prompts.ts, act-card-prompts.ts, character-card-prompts.ts

import { Prompt, loadPromptForStory, registerDefaults } from './prompt-loader';

// === Bundled Default Imports ===

// System & Narration
import defaultSystemPrompt from './prompts/system-prompt.md?raw';
import defaultNarrationTemplate from './prompts/narration-template.md?raw';

// World
import defaultWorldTemplate from './prompts/world/world-template.md?raw';
import defaultGenerateWorldFromChatPrompt from './prompts/world/generate-world-from-chat-prompt.md?raw';
import defaultGenerateWorldFromChatSystemPrompt from './prompts/world/generate-world-from-chat-system-prompt.md?raw';
import defaultWorldBuilderSystemPrompt from './prompts/world/world-builder-system-prompt.md?raw';

// Act
import defaultActCardTemplate from './prompts/act/act-card-template.md?raw';
import defaultActExtractionPrompt from './prompts/act/act-extraction-prompt.md?raw';

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
import defaultReviewerSystemPrompt from './prompts/reviewer/reviewer-system-prompt.md?raw';
import defaultRevisionModeFragment from './prompts/reviewer/revision-mode-fragment.md?raw';
import defaultRevisionRequestExtractionPrompt from './prompts/reviewer/revision-request-extraction-prompt.md?raw';

// Re-export for consumers that need raw content
export {
	defaultSystemPrompt,
	defaultNarrationTemplate,
	defaultWorldTemplate,
	defaultGenerateWorldFromChatPrompt,
	defaultGenerateWorldFromChatSystemPrompt,
	defaultWorldBuilderSystemPrompt,
	defaultActCardTemplate,
	defaultActExtractionPrompt,
	defaultCharacterCardTemplate,
	defaultCharacterCardExtractionPrompt,
	defaultCharacterCardExtractionSystemPrompt,
	defaultSummarizeCharactersInAct,
	defaultActGenerationPrompt,
	defaultChoicesExtractionPrompt,
	defaultMemoryExtractionSystemPrompt,
	defaultMemoryExtractionPrompt,
	defaultReviewerSystemPrompt,
	defaultRevisionModeFragment,
	defaultRevisionRequestExtractionPrompt
};

// === Prompt Config Instances ===

// System & Narration
const systemPrompt = new Prompt({ relativePath: 'system-prompt.md', defaultContent: defaultSystemPrompt });
const narrationTemplate = new Prompt({ relativePath: 'narration-template.md', defaultContent: defaultNarrationTemplate });

// World
const worldTemplate = new Prompt({ relativePath: 'world/world-template.md', defaultContent: defaultWorldTemplate });
const generateWorldFromChatPrompt = new Prompt({ relativePath: 'world/generate-world-from-chat-prompt.md', defaultContent: defaultGenerateWorldFromChatPrompt });
const generateWorldFromChatSystemPrompt = new Prompt({ relativePath: 'world/generate-world-from-chat-system-prompt.md', defaultContent: defaultGenerateWorldFromChatSystemPrompt });
const worldBuilderSystemPrompt = new Prompt({ relativePath: 'world/world-builder-system-prompt.md', defaultContent: defaultWorldBuilderSystemPrompt });

// Act
const actCardTemplate = new Prompt({ relativePath: 'act/act-card-template.md', defaultContent: defaultActCardTemplate });
const actExtractionPrompt = new Prompt({ relativePath: 'act/act-extraction-prompt.md', defaultContent: defaultActExtractionPrompt });

// Character
const characterCardTemplate = new Prompt({ relativePath: 'character/character-card-template.md', defaultContent: defaultCharacterCardTemplate });
const characterCardExtractionPrompt = new Prompt({ relativePath: 'character/character-card-extraction-prompt.md', defaultContent: defaultCharacterCardExtractionPrompt });
const characterCardExtractionSystemPrompt = new Prompt({ relativePath: 'character/character-card-extraction-system-prompt.md', defaultContent: defaultCharacterCardExtractionSystemPrompt });
const summarizeCharactersInAct = new Prompt({ relativePath: 'character/summarize-characters-in-act.md', defaultContent: defaultSummarizeCharactersInAct });

// Import
const actGenerationPrompt = new Prompt({ relativePath: 'import/act-generation-prompt.md', defaultContent: defaultActGenerationPrompt });
const choicesExtractionPrompt = new Prompt({ relativePath: 'import/choices-extraction-prompt.md', defaultContent: defaultChoicesExtractionPrompt });

// Memories
const memoryExtractionSystemPrompt = new Prompt({ relativePath: 'memories/memory-extraction-system-prompt.md', defaultContent: defaultMemoryExtractionSystemPrompt });
const memoryExtractionPrompt = new Prompt({ relativePath: 'memories/memory-extraction-prompt.md', defaultContent: defaultMemoryExtractionPrompt });

// Reviewer
const reviewerSystemPrompt = new Prompt({ relativePath: 'reviewer/reviewer-system-prompt.md', defaultContent: defaultReviewerSystemPrompt });
const revisionModeFragment = new Prompt({ relativePath: 'reviewer/revision-mode-fragment.md', defaultContent: defaultRevisionModeFragment });
const revisionRequestExtractionPrompt = new Prompt({ relativePath: 'reviewer/revision-request-extraction-prompt.md', defaultContent: defaultRevisionRequestExtractionPrompt });

// === Load Functions ===

export const loadSystemPrompt = (): Promise<string> => systemPrompt.load();
export const loadNarrationTemplate = (): Promise<string> => narrationTemplate.load();
export const loadWorldTemplate = (): Promise<string> => worldTemplate.load();
export const loadGenerateWorldFromChatPrompt = (): Promise<string> => generateWorldFromChatPrompt.load();
export const loadGenerateWorldFromChatSystemPrompt = (): Promise<string> => generateWorldFromChatSystemPrompt.load();
export const loadWorldBuilderSystemPrompt = (): Promise<string> => worldBuilderSystemPrompt.load();
export const loadActCardTemplate = (): Promise<string> => actCardTemplate.load();
export const loadActExtractionPrompt = (): Promise<string> => actExtractionPrompt.load();
export const loadCharacterCardTemplate = (): Promise<string> => characterCardTemplate.load();
export const loadCharacterCardExtractionPrompt = (): Promise<string> => characterCardExtractionPrompt.load();
export const loadCharacterCardExtractionSystemPrompt = (): Promise<string> => characterCardExtractionSystemPrompt.load();
export const loadSummarizeCharactersInAct = (): Promise<string> => summarizeCharactersInAct.load();
export const loadActGenerationPrompt = (): Promise<string> => actGenerationPrompt.load();
export const loadChoicesExtractionPrompt = (): Promise<string> => choicesExtractionPrompt.load();
export const loadMemoryExtractionSystemPrompt = (): Promise<string> => memoryExtractionSystemPrompt.load();
export const loadMemoryExtractionPrompt = (): Promise<string> => memoryExtractionPrompt.load();
export const loadReviewerSystemPrompt = (): Promise<string> => reviewerSystemPrompt.load();
export const loadRevisionModeFragment = (): Promise<string> => revisionModeFragment.load();
export const loadRevisionRequestExtractionPrompt = (): Promise<string> => revisionRequestExtractionPrompt.load();

export const getDefaultSystemPromptContent = () => defaultSystemPrompt;
export const getDefaultNarrationTemplateContent = () => defaultNarrationTemplate;

// Story-specific loaders
export async function loadStorySystemPrompt(storyId: string, storyName: string): Promise<string> {
	return loadPromptForStory(storyId, storyName, systemPrompt.relativePath, systemPrompt.defaultContent);
}

export async function loadStoryNarrationTemplate(storyId: string, storyName: string): Promise<string> {
	return loadPromptForStory(storyId, storyName, narrationTemplate.relativePath, narrationTemplate.defaultContent);
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
	characterCardTemplate,
	characterCardExtractionPrompt,
	characterCardExtractionSystemPrompt,
	summarizeCharactersInAct,
	actGenerationPrompt,
	choicesExtractionPrompt,
	memoryExtractionSystemPrompt,
	memoryExtractionPrompt,
	reviewerSystemPrompt,
	revisionModeFragment,
	revisionRequestExtractionPrompt
]);
