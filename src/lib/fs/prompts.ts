// Unified prompt loading module
// Replaces: system-prompt.ts, world-prompts.ts, act-card-prompts.ts, character-card-prompts.ts

import { Prompt, loadPromptForStory, registerDefaults } from './prompt-loader';

// === Bundled Default Imports ===

// System
import defaultSystemPrompt from './prompts/system-prompt.md?raw';

// General Instructions
import defaultGeneralInstructions from './prompts/general-instructions.md?raw';

// Pipeline: Plot Planner
import defaultPlotPlannerPrompt from './prompts/plot-planner/plot-planner-prompt.md?raw';

// Pipeline: Writer
import defaultWriterPrompt from './prompts/writer/writer-prompt.md?raw';
import defaultWriterOutputTemplate from './prompts/writer/writer-output-template.md?raw';

// Pipeline: Reviewer
import defaultReviewerPrompt from './prompts/reviewer/reviewer-prompt.md?raw';

// Pipeline: Editor
import defaultEditorPrompt from './prompts/editor/editor-prompt.md?raw';

// Pipeline: Game Master
import defaultGameMasterPrompt from './prompts/game-master/game-master-prompt.md?raw';

// Pipeline: Summarizer
import defaultSummarizerPrompt from './prompts/summarizer/summarizer-prompt.md?raw';
import defaultActSummaryTemplate from './prompts/summarizer/act-summary-template.md?raw';
import defaultSummarizerIncrementalPrompt from './prompts/summarizer/summarizer-incremental-prompt.md?raw';
import defaultActSummaryIncrementalTemplate from './prompts/summarizer/act-summary-incremental-template.md?raw';

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
import defaultActPlotSystemPrompt from './prompts/act/act-plot-system-prompt.md?raw';
import defaultActPlotReviewerPrompt from './prompts/act/act-plot-reviewer-prompt.md?raw';
import defaultActPlotEditorPrompt from './prompts/act/act-plot-editor-prompt.md?raw';
import defaultInterviewExtractionPrompt from './prompts/interview-extraction-prompt.md?raw';

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

// Re-export for consumers that need raw content
export {
	defaultSystemPrompt,
	defaultGeneralInstructions,
	defaultPlotPlannerPrompt,
	defaultWriterPrompt,
	defaultWriterOutputTemplate,
	defaultReviewerPrompt,
	defaultEditorPrompt,
	defaultGameMasterPrompt,
	defaultSummarizerPrompt,
	defaultActSummaryTemplate,
	defaultSummarizerIncrementalPrompt,
	defaultActSummaryIncrementalTemplate,
	defaultWorldTemplate,
	defaultGenerateWorldFromChatPrompt,
	defaultGenerateWorldFromChatSystemPrompt,
	defaultWorldBuilderSystemPrompt,
	defaultActCardTemplate,
	defaultActExtractionPrompt,
	defaultActPlotTemplate,
	defaultActPlotGenerationPrompt,
	defaultInterviewExtractionPrompt,
	defaultActPlotSystemPrompt,
	defaultActPlotReviewerPrompt,
	defaultActPlotEditorPrompt,
	defaultCharacterCardTemplate,
	defaultCharacterCardExtractionPrompt,
	defaultCharacterCardExtractionSystemPrompt,
	defaultSummarizeCharactersInAct,
	defaultActGenerationPrompt,
	defaultChoicesExtractionPrompt,
	defaultMemoryExtractionSystemPrompt,
	defaultMemoryExtractionPrompt,
};

// === Prompt Config Instances ===

// System
const systemPrompt = new Prompt({ relativePath: 'system-prompt.md', defaultContent: defaultSystemPrompt });

// General Instructions
const generalInstructions = new Prompt({ relativePath: 'general-instructions.md', defaultContent: defaultGeneralInstructions });

// Pipeline: Plot Planner
const plotPlannerPrompt = new Prompt({ relativePath: 'plot-planner/plot-planner-prompt.md', defaultContent: defaultPlotPlannerPrompt });

// Pipeline: Writer
const writerPrompt = new Prompt({ relativePath: 'writer/writer-prompt.md', defaultContent: defaultWriterPrompt });
const writerOutputTemplate = new Prompt({ relativePath: 'writer/writer-output-template.md', defaultContent: defaultWriterOutputTemplate });

// Pipeline: Reviewer
const reviewerPrompt = new Prompt({ relativePath: 'reviewer/reviewer-prompt.md', defaultContent: defaultReviewerPrompt });

// Pipeline: Editor
const editorPrompt = new Prompt({ relativePath: 'editor/editor-prompt.md', defaultContent: defaultEditorPrompt });

// Pipeline: Game Master
const gameMasterPrompt = new Prompt({ relativePath: 'game-master/game-master-prompt.md', defaultContent: defaultGameMasterPrompt });

// Pipeline: Summarizer
const summarizerPrompt = new Prompt({ relativePath: 'summarizer/summarizer-prompt.md', defaultContent: defaultSummarizerPrompt });
const actSummaryTemplate = new Prompt({ relativePath: 'summarizer/act-summary-template.md', defaultContent: defaultActSummaryTemplate });
const summarizerIncrementalPrompt = new Prompt({
	relativePath: 'summarizer/summarizer-incremental-prompt.md',
	defaultContent: defaultSummarizerIncrementalPrompt,
});
const actSummaryIncrementalTemplate = new Prompt({
	relativePath: 'summarizer/act-summary-incremental-template.md',
	defaultContent: defaultActSummaryIncrementalTemplate,
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
const actPlotSystemPrompt = new Prompt({
	relativePath: 'act/act-plot-system-prompt.md',
	defaultContent: defaultActPlotSystemPrompt,
});
const actPlotReviewerPrompt = new Prompt({
	relativePath: 'act/act-plot-reviewer-prompt.md',
	defaultContent: defaultActPlotReviewerPrompt,
});
const actPlotEditorPrompt = new Prompt({
	relativePath: 'act/act-plot-editor-prompt.md',
	defaultContent: defaultActPlotEditorPrompt,
});
const interviewExtractionPrompt = new Prompt({
	relativePath: 'interview-extraction-prompt.md',
	defaultContent: defaultInterviewExtractionPrompt,
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

// === Load Functions ===

export const loadSystemPrompt = (): Promise<string> => systemPrompt.load();
export const loadGeneralInstructions = (): Promise<string> => generalInstructions.load();
export const loadPlotPlannerPrompt = (): Promise<string> => plotPlannerPrompt.load();
export const loadWriterPrompt = (): Promise<string> => writerPrompt.load();
export const loadWriterOutputTemplate = (): Promise<string> => writerOutputTemplate.load();
export const loadReviewerPrompt = (): Promise<string> => reviewerPrompt.load();
export const loadEditorPrompt = (): Promise<string> => editorPrompt.load();
export const loadGameMasterPrompt = (): Promise<string> => gameMasterPrompt.load();
export const loadSummarizerPrompt = (): Promise<string> => summarizerPrompt.load();
export const loadActSummaryTemplate = (): Promise<string> => actSummaryTemplate.load();
export const loadSummarizerIncrementalPrompt = (): Promise<string> => summarizerIncrementalPrompt.load();
export const loadActSummaryIncrementalTemplate = (): Promise<string> => actSummaryIncrementalTemplate.load();
export const loadWorldTemplate = (): Promise<string> => worldTemplate.load();
export const loadGenerateWorldFromChatPrompt = (): Promise<string> => generateWorldFromChatPrompt.load();
export const loadGenerateWorldFromChatSystemPrompt = (): Promise<string> => generateWorldFromChatSystemPrompt.load();
export const loadWorldBuilderSystemPrompt = (): Promise<string> => worldBuilderSystemPrompt.load();
export const loadActCardTemplate = (): Promise<string> => actCardTemplate.load();
export const loadActExtractionPrompt = (): Promise<string> => actExtractionPrompt.load();
export const loadActPlotTemplate = (): Promise<string> => actPlotTemplate.load();
export const loadActPlotGenerationPrompt = (): Promise<string> => actPlotGenerationPrompt.load();
export const loadActPlotSystemPrompt = (): Promise<string> => actPlotSystemPrompt.load();
export const loadActPlotReviewerPrompt = (): Promise<string> => actPlotReviewerPrompt.load();
export const loadActPlotEditorPrompt = (): Promise<string> => actPlotEditorPrompt.load();
export const loadInterviewExtractionPrompt = (): Promise<string> => interviewExtractionPrompt.load();
export const loadCharacterCardTemplate = (): Promise<string> => characterCardTemplate.load();
export const loadCharacterCardExtractionPrompt = (): Promise<string> => characterCardExtractionPrompt.load();
export const loadCharacterCardExtractionSystemPrompt = (): Promise<string> => characterCardExtractionSystemPrompt.load();
export const loadSummarizeCharactersInAct = (): Promise<string> => summarizeCharactersInAct.load();
export const loadActGenerationPrompt = (): Promise<string> => actGenerationPrompt.load();
export const loadChoicesExtractionPrompt = (): Promise<string> => choicesExtractionPrompt.load();
export const loadMemoryExtractionSystemPrompt = (): Promise<string> => memoryExtractionSystemPrompt.load();
export const loadMemoryExtractionPrompt = (): Promise<string> => memoryExtractionPrompt.load();

export const getDefaultSystemPromptContent = () => defaultSystemPrompt;

// Story-specific loaders
export async function loadStorySystemPrompt(storyId: string, storyName: string): Promise<string> {
	return loadPromptForStory(storyId, storyName, systemPrompt.relativePath, systemPrompt.defaultContent);
}

export async function loadStoryGeneralInstructions(storyId: string, storyName: string): Promise<string> {
	return loadPromptForStory(storyId, storyName, generalInstructions.relativePath, generalInstructions.defaultContent);
}

// Story-specific pipeline prompt loaders
export async function loadStoryPlotPlannerPrompt(storyId: string, storyName: string): Promise<string> {
	return loadPromptForStory(storyId, storyName, plotPlannerPrompt.relativePath, plotPlannerPrompt.defaultContent);
}

export async function loadStoryWriterPrompt(storyId: string, storyName: string): Promise<string> {
	return loadPromptForStory(storyId, storyName, writerPrompt.relativePath, writerPrompt.defaultContent);
}

export async function loadStoryWriterOutputTemplate(storyId: string, storyName: string): Promise<string> {
	return loadPromptForStory(storyId, storyName, writerOutputTemplate.relativePath, writerOutputTemplate.defaultContent);
}

export async function loadStoryReviewerPrompt(storyId: string, storyName: string): Promise<string> {
	return loadPromptForStory(storyId, storyName, reviewerPrompt.relativePath, reviewerPrompt.defaultContent);
}

export async function loadStoryEditorPrompt(storyId: string, storyName: string): Promise<string> {
	return loadPromptForStory(storyId, storyName, editorPrompt.relativePath, editorPrompt.defaultContent);
}

export async function loadStoryGameMasterPrompt(storyId: string, storyName: string): Promise<string> {
	return loadPromptForStory(storyId, storyName, gameMasterPrompt.relativePath, gameMasterPrompt.defaultContent);
}

export async function loadStorySummarizerPrompt(storyId: string, storyName: string): Promise<string> {
	return loadPromptForStory(storyId, storyName, summarizerPrompt.relativePath, summarizerPrompt.defaultContent);
}

export async function loadStoryActSummaryTemplate(storyId: string, storyName: string): Promise<string> {
	return loadPromptForStory(storyId, storyName, actSummaryTemplate.relativePath, actSummaryTemplate.defaultContent);
}

export async function loadStorySummarizerIncrementalPrompt(storyId: string, storyName: string): Promise<string> {
	return loadPromptForStory(storyId, storyName, summarizerIncrementalPrompt.relativePath, summarizerIncrementalPrompt.defaultContent);
}

export async function loadStoryActSummaryIncrementalTemplate(storyId: string, storyName: string): Promise<string> {
	return loadPromptForStory(storyId, storyName, actSummaryIncrementalTemplate.relativePath, actSummaryIncrementalTemplate.defaultContent);
}

// === Prompt loaders ===

export interface PromptLoader {
	loadByStory: (storyId: string, storyName: string) => Promise<string>;
	loadDefault: () => Promise<string>;
}

export const generalInstructionsLoader: PromptLoader = {
	loadByStory: loadStoryGeneralInstructions,
	loadDefault: loadGeneralInstructions,
};

export const plotPlannerSystemPromptLoader: PromptLoader = {
	loadByStory: loadStoryPlotPlannerPrompt,
	loadDefault: loadPlotPlannerPrompt,
};

export const writerSystemPromptLoader: PromptLoader = {
	loadByStory: loadStoryWriterPrompt,
	loadDefault: loadWriterPrompt,
};

export const writerOutputTemplateLoader: PromptLoader = {
	loadByStory: loadStoryWriterOutputTemplate,
	loadDefault: loadWriterOutputTemplate,
};

export const reviewerSystemPromptTemplateLoader: PromptLoader = {
	loadByStory: loadStoryReviewerPrompt,
	loadDefault: loadReviewerPrompt,
};

export const editorSystemPromptLoader: PromptLoader = {
	loadByStory: loadStoryEditorPrompt,
	loadDefault: loadEditorPrompt,
};

export const gameMasterSystemPromptLoader: PromptLoader = {
	loadByStory: loadStoryGameMasterPrompt,
	loadDefault: loadGameMasterPrompt,
};

export const summarizerPromptLoader: PromptLoader = {
	loadByStory: loadStorySummarizerPrompt,
	loadDefault: loadSummarizerPrompt,
};

export const actSummaryTemplateLoader: PromptLoader = {
	loadByStory: loadStoryActSummaryTemplate,
	loadDefault: loadActSummaryTemplate,
};

export const summarizerIncrementalPromptLoader: PromptLoader = {
	loadByStory: loadStorySummarizerIncrementalPrompt,
	loadDefault: loadSummarizerIncrementalPrompt,
};

export const actSummaryIncrementalTemplateLoader: PromptLoader = {
	loadByStory: loadStoryActSummaryIncrementalTemplate,
	loadDefault: loadActSummaryIncrementalTemplate,
};

// === Ensure All Base Configs ===

export { ensureAllBaseConfigs } from './prompt-loader';

// Register all defaults so ensureAllBaseConfigs() can create them on launch
registerDefaults([
	systemPrompt,
	generalInstructions,
	plotPlannerPrompt,
	writerPrompt,
	writerOutputTemplate,
	reviewerPrompt,
	editorPrompt,
	gameMasterPrompt,
	summarizerPrompt,
	actSummaryTemplate,
	summarizerIncrementalPrompt,
	actSummaryIncrementalTemplate,
	worldTemplate,
	generateWorldFromChatPrompt,
	generateWorldFromChatSystemPrompt,
	worldBuilderSystemPrompt,
	actCardTemplate,
	actExtractionPrompt,
	actPlotTemplate,
	actPlotGenerationPrompt,
	actPlotSystemPrompt,
	actPlotReviewerPrompt,
	actPlotEditorPrompt,
	interviewExtractionPrompt,
	characterCardTemplate,
	characterCardExtractionPrompt,
	characterCardExtractionSystemPrompt,
	summarizeCharactersInAct,
	actGenerationPrompt,
	choicesExtractionPrompt,
	memoryExtractionSystemPrompt,
	memoryExtractionPrompt,
]);
