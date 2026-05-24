// Unified prompt loading module
// Replaces: system-prompt.ts, world-prompts.ts, act-card-prompts.ts, character-card-prompts.ts

import { LocalizedPromptFile, registerDefaults } from './prompt-loader';
import type { SupportedLocale } from './prompt-loader';

// === Bundled Defaults via import.meta.glob ===
// Each locale's prompt files are batch-imported at build time.
// Adding a new prompt file only requires: drop the .md file + add a Prompt() constructor below.
// Adding a new locale requires: add glob line + add to SUPPORTED_LOCALES + create directory.

const promptDefaults: Record<SupportedLocale, Record<string, string>> = {
	en: import.meta.glob('./en/prompts/**/*.md', {
		eager: true,
		query: '?raw',
		import: 'default' as const,
	}) as Record<string, string>,
	'zh-Hant-HK': import.meta.glob('./zh-Hant-HK/prompts/**/*.md', {
		eager: true,
		query: '?raw',
		import: 'default' as const,
	}) as Record<string, string>,
};

// === Prompt Config Instances ===

// General Instructions
const generalInstructions = new LocalizedPromptFile(promptDefaults, 'general-instructions.md');

// Pipeline: Plot Planner
const guidancePlotPlannerPrompt = new LocalizedPromptFile(promptDefaults, 'plot-planner/guidance-plot-planner-prompt.md');
const phaseEventPlotPlannerPrompt = new LocalizedPromptFile(promptDefaults, 'plot-planner/phase-event-plot-planner-prompt.md');

// Pipeline: Writer
const writerPrompt = new LocalizedPromptFile(promptDefaults, 'writer/writer-prompt.md');
const writerOutputTemplate = new LocalizedPromptFile(promptDefaults, 'writer/writer-output-template.md');
const guidanceWriterExtractionPrompt = new LocalizedPromptFile(promptDefaults, 'writer/guidance-writer-extraction-prompt.md');
const phaseEventWriterExtractionPrompt = new LocalizedPromptFile(promptDefaults, 'writer/phase-event-writer-extraction-prompt.md');

// Pipeline: Reviewer
const reviewerPrompt = new LocalizedPromptFile(promptDefaults, 'reviewer/reviewer-prompt.md');
const quickReviewerPrompt = new LocalizedPromptFile(promptDefaults, 'reviewer/quick-reviewer-prompt.md');

// Pipeline: Editor
const editorPrompt = new LocalizedPromptFile(promptDefaults, 'editor/editor-prompt.md');

// Pipeline: Game Master
const gameMasterPrompt = new LocalizedPromptFile(promptDefaults, 'game-master/game-master-prompt.md');

// Pipeline: Summarizer
const summarizerPrompt = new LocalizedPromptFile(promptDefaults, 'summarizer/summarizer-prompt.md');
const summarizerIncrementalPrompt = new LocalizedPromptFile(promptDefaults, 'summarizer/summarizer-incremental-prompt.md');
const actSummaryIncrementalTemplate = new LocalizedPromptFile(promptDefaults, 'summarizer/act-summary-incremental-template.md');

// Pipeline: Character Profile Compressor
const characterProfileCompressorPrompt = new LocalizedPromptFile(promptDefaults, 'summarizer/character-profile-compressor.md');

// World
const worldTemplate = new LocalizedPromptFile(promptDefaults, 'world/world-template.md');
const generateWorldFromChatPrompt = new LocalizedPromptFile(promptDefaults, 'world/generate-world-from-chat-prompt.md');
const generateWorldFromChatSystemPrompt = new LocalizedPromptFile(promptDefaults, 'world/generate-world-from-chat-system-prompt.md');
const generateWorldFromCardsPrompt = new LocalizedPromptFile(promptDefaults, 'world/generate-world-from-cards-prompt.md');
const generateWorldFromCardsSystemPrompt = new LocalizedPromptFile(promptDefaults, 'world/generate-world-from-cards-system-prompt.md');
const worldBuilderSystemPrompt = new LocalizedPromptFile(promptDefaults, 'world/world-builder-system-prompt.md');

// Act
const actCardTemplate = new LocalizedPromptFile(promptDefaults, 'act/act-card-template.md');
const actPlotTemplate = new LocalizedPromptFile(promptDefaults, 'act/guidance-act-plot-template.md');
const phaseEventActPlotTemplate = new LocalizedPromptFile(promptDefaults, 'act/phase-event-act-plot-template.md');
const actPlotGenerationPrompt = new LocalizedPromptFile(promptDefaults, 'act/act-plot-generation-prompt.md');
const actPlotSystemPrompt = new LocalizedPromptFile(promptDefaults, 'act/act-plot-system-prompt.md');
const actPlotInterviewSystemPrompt = new LocalizedPromptFile(promptDefaults, 'act/act-plot-interview-system-prompt.md');
const actPlotReviewerPrompt = new LocalizedPromptFile(promptDefaults, 'act/act-plot-reviewer-prompt.md');
const actPlotEditorPrompt = new LocalizedPromptFile(promptDefaults, 'act/act-plot-editor-prompt.md');
const actPlotInterviewExtractionPrompt = new LocalizedPromptFile(promptDefaults, 'act/act-plot-interview-extraction-prompt.md');
const actPlotInterviewTurnOfEventsPrompt = new LocalizedPromptFile(promptDefaults, 'act/act-plot-interview-turn-of-events-prompt.md');

// Character
const characterCardTemplate = new LocalizedPromptFile(promptDefaults, 'character/character-card-template.md');
const characterCardExtractionPrompt = new LocalizedPromptFile(promptDefaults, 'character/character-card-extraction-prompt.md');

// Import
const choicesExtractionPrompt = new LocalizedPromptFile(promptDefaults, 'import/choices-extraction-prompt.md');

// Memories
const memoryExtractionSystemPrompt = new LocalizedPromptFile(promptDefaults, 'memories/memory-extraction-system-prompt.md');
const memoryExtractionPrompt = new LocalizedPromptFile(promptDefaults, 'memories/memory-extraction-prompt.md');

// Features
const importantPhrasesPrompt = new LocalizedPromptFile(promptDefaults, 'features/important-phrases-prompt.md');

// === Load Functions ===

export const loadGeneralInstructions = (): Promise<string> => generalInstructions.load();
export const loadPlotPlannerPrompt = (): Promise<string> => guidancePlotPlannerPrompt.load();
export const loadGuidancePlotPlannerPrompt = (): Promise<string> => guidancePlotPlannerPrompt.load();
export const loadPhaseEventPlotPlannerPrompt = (): Promise<string> => phaseEventPlotPlannerPrompt.load();
export const loadPlotPlannerPromptForMode = (mode: 'guidance' | 'phaseEvent'): Promise<string> =>
	mode === 'phaseEvent' ? phaseEventPlotPlannerPrompt.load() : guidancePlotPlannerPrompt.load();
export const loadWriterPrompt = (): Promise<string> => writerPrompt.load();
export const loadWriterOutputTemplate = (): Promise<string> => writerOutputTemplate.load();
export const loadGuidanceWriterExtractionPrompt = (): Promise<string> => guidanceWriterExtractionPrompt.load();
export const loadPhaseEventWriterExtractionPrompt = (): Promise<string> => phaseEventWriterExtractionPrompt.load();
export const loadReviewerPrompt = (): Promise<string> => reviewerPrompt.load();
export const loadQuickReviewerPrompt = (): Promise<string> => quickReviewerPrompt.load();
export const loadEditorPrompt = (): Promise<string> => editorPrompt.load();
export const loadGameMasterPrompt = (): Promise<string> => gameMasterPrompt.load();
export const loadSummarizerPrompt = (): Promise<string> => summarizerPrompt.load();
export const loadSummarizerIncrementalPrompt = (): Promise<string> => summarizerIncrementalPrompt.load();
export const loadActSummaryIncrementalTemplate = (): Promise<string> => actSummaryIncrementalTemplate.load();
export const loadCharacterProfileCompressorPrompt = (): Promise<string> => characterProfileCompressorPrompt.load();
export const loadWorldTemplate = (): Promise<string> => worldTemplate.load();
export const loadGenerateWorldFromChatPrompt = (): Promise<string> => generateWorldFromChatPrompt.load();
export const loadGenerateWorldFromChatSystemPrompt = (): Promise<string> => generateWorldFromChatSystemPrompt.load();
export const loadGenerateWorldFromCardsPrompt = (): Promise<string> => generateWorldFromCardsPrompt.load();
export const loadGenerateWorldFromCardsSystemPrompt = (): Promise<string> => generateWorldFromCardsSystemPrompt.load();
export const loadWorldBuilderSystemPrompt = (): Promise<string> => worldBuilderSystemPrompt.load();
export const loadActCardTemplate = (): Promise<string> => actCardTemplate.load();
export const loadActPlotTemplate = (): Promise<string> => actPlotTemplate.load();
export const loadGuidanceActPlotTemplate = (): Promise<string> => actPlotTemplate.load();
export const loadPhaseEventActPlotTemplate = (): Promise<string> => phaseEventActPlotTemplate.load();
export const loadActPlotTemplateForMode = (mode: 'guidance' | 'phaseEvent'): Promise<string> =>
	mode === 'phaseEvent' ? phaseEventActPlotTemplate.load() : actPlotTemplate.load();
export const loadActPlotGenerationPrompt = (): Promise<string> => actPlotGenerationPrompt.load();
export const loadActPlotSystemPrompt = (): Promise<string> => actPlotSystemPrompt.load();
export const loadActPlotInterviewSystemPrompt = (): Promise<string> => actPlotInterviewSystemPrompt.load();
export const loadActPlotReviewerPrompt = (): Promise<string> => actPlotReviewerPrompt.load();
export const loadActPlotEditorPrompt = (): Promise<string> => actPlotEditorPrompt.load();
export const loadActPlotInterviewExtractionPrompt = (): Promise<string> => actPlotInterviewExtractionPrompt.load();
export const loadActPlotInterviewTurnOfEventsPrompt = (): Promise<string> => actPlotInterviewTurnOfEventsPrompt.load();
export const loadCharacterCardTemplate = (): Promise<string> => characterCardTemplate.load();
export const loadCharacterCardExtractionPrompt = (): Promise<string> => characterCardExtractionPrompt.load();
export const loadChoicesExtractionPrompt = (): Promise<string> => choicesExtractionPrompt.load();
export const loadImportantPhrasesPrompt = (): Promise<string> => importantPhrasesPrompt.load();
export const loadMemoryExtractionSystemPrompt = (): Promise<string> => memoryExtractionSystemPrompt.load();
export const loadMemoryExtractionPrompt = (): Promise<string> => memoryExtractionPrompt.load();

// Story-specific loaders
export async function loadStoryGeneralInstructions(storyId: string, storyName: string): Promise<string> {
	return generalInstructions.loadForStory(storyId, storyName);
}

// Story-specific pipeline prompt loaders
export async function loadStoryPlotPlannerPrompt(storyId: string, storyName: string): Promise<string> {
	return guidancePlotPlannerPrompt.loadForStory(storyId, storyName);
}

export async function loadStoryPhaseEventPlotPlannerPrompt(storyId: string, storyName: string): Promise<string> {
	return phaseEventPlotPlannerPrompt.loadForStory(storyId, storyName);
}

export function loadStoryPlotPlannerPromptForMode(storyId: string, storyName: string, mode: 'guidance' | 'phaseEvent'): Promise<string> {
	return mode === 'phaseEvent' ? loadStoryPhaseEventPlotPlannerPrompt(storyId, storyName) : loadStoryPlotPlannerPrompt(storyId, storyName);
}

export async function loadStoryWriterPrompt(storyId: string, storyName: string): Promise<string> {
	return writerPrompt.loadForStory(storyId, storyName);
}

export async function loadStoryWriterOutputTemplate(storyId: string, storyName: string): Promise<string> {
	return writerOutputTemplate.loadForStory(storyId, storyName);
}

export async function loadStoryGuidanceWriterExtractionPrompt(storyId: string, storyName: string): Promise<string> {
	return guidanceWriterExtractionPrompt.loadForStory(storyId, storyName);
}

export async function loadStoryPhaseEventWriterExtractionPrompt(storyId: string, storyName: string): Promise<string> {
	return phaseEventWriterExtractionPrompt.loadForStory(storyId, storyName);
}

export async function loadStoryReviewerPrompt(storyId: string, storyName: string): Promise<string> {
	return reviewerPrompt.loadForStory(storyId, storyName);
}

export async function loadStoryQuickReviewerPrompt(storyId: string, storyName: string): Promise<string> {
	return quickReviewerPrompt.loadForStory(storyId, storyName);
}

export async function loadStoryEditorPrompt(storyId: string, storyName: string): Promise<string> {
	return editorPrompt.loadForStory(storyId, storyName);
}

export async function loadStoryGameMasterPrompt(storyId: string, storyName: string): Promise<string> {
	return gameMasterPrompt.loadForStory(storyId, storyName);
}

export async function loadStorySummarizerPrompt(storyId: string, storyName: string): Promise<string> {
	return summarizerPrompt.loadForStory(storyId, storyName);
}

export async function loadStorySummarizerIncrementalPrompt(storyId: string, storyName: string): Promise<string> {
	return summarizerIncrementalPrompt.loadForStory(storyId, storyName);
}

export async function loadStoryActSummaryIncrementalTemplate(storyId: string, storyName: string): Promise<string> {
	return actSummaryIncrementalTemplate.loadForStory(storyId, storyName);
}

export async function loadStoryCharacterProfileCompressorPrompt(storyId: string, storyName: string): Promise<string> {
	return characterProfileCompressorPrompt.loadForStory(storyId, storyName);
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

export const phaseEventPlotPlannerSystemPromptLoader: PromptLoader = {
	loadByStory: loadStoryPhaseEventPlotPlannerPrompt,
	loadDefault: loadPhaseEventPlotPlannerPrompt,
};

export const writerSystemPromptLoader: PromptLoader = {
	loadByStory: loadStoryWriterPrompt,
	loadDefault: loadWriterPrompt,
};

export const writerOutputTemplateLoader: PromptLoader = {
	loadByStory: loadStoryWriterOutputTemplate,
	loadDefault: loadWriterOutputTemplate,
};

export const guidanceWriterExtractionPromptLoader: PromptLoader = {
	loadByStory: loadStoryGuidanceWriterExtractionPrompt,
	loadDefault: loadGuidanceWriterExtractionPrompt,
};

export const phaseEventWriterExtractionPromptLoader: PromptLoader = {
	loadByStory: loadStoryPhaseEventWriterExtractionPrompt,
	loadDefault: loadPhaseEventWriterExtractionPrompt,
};

export const reviewerSystemPromptTemplateLoader: PromptLoader = {
	loadByStory: loadStoryReviewerPrompt,
	loadDefault: loadReviewerPrompt,
};

export const quickReviewerSystemPromptTemplateLoader: PromptLoader = {
	loadByStory: loadStoryQuickReviewerPrompt,
	loadDefault: loadQuickReviewerPrompt,
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

export const summarizerIncrementalPromptLoader: PromptLoader = {
	loadByStory: loadStorySummarizerIncrementalPrompt,
	loadDefault: loadSummarizerIncrementalPrompt,
};

export const actSummaryIncrementalTemplateLoader: PromptLoader = {
	loadByStory: loadStoryActSummaryIncrementalTemplate,
	loadDefault: loadActSummaryIncrementalTemplate,
};

export const characterProfileCompressorPromptLoader: PromptLoader = {
	loadByStory: loadStoryCharacterProfileCompressorPrompt,
	loadDefault: loadCharacterProfileCompressorPrompt,
};

// === Ensure All Base Configs ===

// Register all defaults so ensureAllBaseConfigs() can create them on launch
registerDefaults([
	generalInstructions,
	guidancePlotPlannerPrompt,
	phaseEventPlotPlannerPrompt,
	writerPrompt,
	writerOutputTemplate,
	guidanceWriterExtractionPrompt,
	phaseEventWriterExtractionPrompt,
	reviewerPrompt,
	quickReviewerPrompt,
	editorPrompt,
	gameMasterPrompt,
	summarizerPrompt,
	summarizerIncrementalPrompt,
	actSummaryIncrementalTemplate,
	characterProfileCompressorPrompt,
	worldTemplate,
	generateWorldFromChatPrompt,
	generateWorldFromChatSystemPrompt,
	worldBuilderSystemPrompt,
	actCardTemplate,
	actPlotTemplate,
	phaseEventActPlotTemplate,
	actPlotGenerationPrompt,
	actPlotSystemPrompt,
	actPlotInterviewSystemPrompt,
	actPlotReviewerPrompt,
	actPlotEditorPrompt,
	actPlotInterviewExtractionPrompt,
	actPlotInterviewTurnOfEventsPrompt,
	characterCardTemplate,
	characterCardExtractionPrompt,
	choicesExtractionPrompt,
	generateWorldFromCardsPrompt,
	generateWorldFromCardsSystemPrompt,
	importantPhrasesPrompt,
	memoryExtractionSystemPrompt,
	memoryExtractionPrompt,
]);
