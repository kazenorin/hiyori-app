import { LocalizedPromptFile, registerDefaults } from './prompt-loader';
import type { SupportedLocale } from './prompt-loader';

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

export interface PromptLoader {
	loadByStory: (storyId: string, storyName: string) => Promise<string>;
	loadDefault: () => Promise<string>;
}

function createLoader(path: string): PromptLoader {
	const file = new LocalizedPromptFile(promptDefaults, path);
	const loader: PromptLoader = {
		loadByStory: (storyId, storyName) => file.loadForStory(storyId, storyName),
		loadDefault: () => file.load(),
	};
	registerDefaults([file]);
	return loader;
}

// === Writer pipeline ===

export const writerSystemPromptLoader = createLoader('writer/writer-prompt.md');
export const writerOutputTemplateLoader = createLoader('writer/writer-output-template.md');

// === Review pipeline ===

export const reviewerSystemPromptTemplateLoader = createLoader('reviewer/reviewer-prompt.md');
export const quickReviewerSystemPromptTemplateLoader = createLoader('reviewer/quick-reviewer-prompt.md');

// === Editor pipeline ===

export const editorSystemPromptLoader = createLoader('editor/editor-prompt.md');

// === Plot planner ===

export const plotPlannerSystemPromptLoader = createLoader('plot-planner/guidance-plot-planner-prompt.md');
export const phaseEventPlotPlannerSystemPromptLoader = createLoader('plot-planner/phase-event-plot-planner-prompt.md');

// === Game master ===

export const gameMasterSystemPromptLoader = createLoader('game-master/game-master-prompt.md');

// === Summarizer ===

export const summarizerPromptLoader = createLoader('summarizer/summarizer-prompt.md');
export const summarizerIncrementalPromptLoader = createLoader('summarizer/summarizer-incremental-prompt.md');
export const characterProfileCompressorPromptLoader = createLoader('summarizer/character-profile-compressor.md');

// === General instructions ===

export const generalInstructionsLoader = createLoader('general-instructions.md');

// === World builder ===

export const worldTemplateLoader = createLoader('world/world-template.md');
export const worldBuilderSystemPromptLoader = createLoader('world/world-builder-system-prompt.md');

// === Act plot ===

export const guidanceActPlotTemplateLoader = createLoader('act/guidance-act-plot-template.md');
export const phaseEventActPlotTemplateLoader = createLoader('act/phase-event-act-plot-template.md');
export const actPlotGenerationPromptLoader = createLoader('act/act-plot-generation-prompt.md');
export const actPlotSystemPromptLoader = createLoader('act/act-plot-system-prompt.md');
export const actPlotInterviewSystemPromptLoader = createLoader('act/act-plot-interview-system-prompt.md');
export const actPlotReviewerPromptLoader = createLoader('act/act-plot-reviewer-prompt.md');
export const actPlotEditorPromptLoader = createLoader('act/act-plot-editor-prompt.md');
export const actPlotInterviewTurnOfEventsPromptLoader = createLoader('act/act-plot-interview-turn-of-events-prompt.md');
export const actCardTemplateLoader = createLoader('act/act-card-template.md');

// === Character cards ===

export const characterCardTemplateLoader = createLoader('character/character-card-template.md');

// === Memory extraction ===

export const memoryExtractionSystemPromptLoader = createLoader('memories/memory-extraction-system-prompt.md');
export const memoryExtractionPromptLoader = createLoader('memories/memory-extraction-prompt.md');
