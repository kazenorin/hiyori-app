import {
	actSummaryIncrementalTemplateLoader,
	characterProfileCompressorPromptLoader,
	editorSystemPromptLoader,
	gameMasterSystemPromptLoader,
	generalInstructionsLoader,
	guidanceWriterExtractionPromptLoader,
	phaseEventPlotPlannerSystemPromptLoader,
	phaseEventWriterExtractionPromptLoader,
	plotPlannerSystemPromptLoader,
	type PromptLoader,
	quickReviewerSystemPromptTemplateLoader,
	reviewerSystemPromptTemplateLoader,
	summarizerIncrementalPromptLoader,
	summarizerPromptLoader,
	writerOutputTemplateLoader,
	writerSystemPromptLoader,
} from '$lib/fs/prompts';

const promptLoaderDefinitions = {
	generalInstructions: generalInstructionsLoader,
	plotPlannerSystemPrompt: plotPlannerSystemPromptLoader,
	phaseEventPlotPlannerSystemPrompt: phaseEventPlotPlannerSystemPromptLoader,
	writerSystemPrompt: writerSystemPromptLoader,
	writerOutputTemplate: writerOutputTemplateLoader,
	guidanceWriterExtractionPrompt: guidanceWriterExtractionPromptLoader,
	phaseEventWriterExtractionPrompt: phaseEventWriterExtractionPromptLoader,
	reviewerSystemPromptTemplate: reviewerSystemPromptTemplateLoader,
	quickReviewerSystemPromptTemplate: quickReviewerSystemPromptTemplateLoader,
	editorSystemPrompt: editorSystemPromptLoader,
	gameMasterSystemPrompt: gameMasterSystemPromptLoader,
	summarizerPrompt: summarizerPromptLoader,
	summarizerIncrementalPrompt: summarizerIncrementalPromptLoader,
	actSummaryIncrementalTemplate: actSummaryIncrementalTemplateLoader,
	characterProfileCompressorPrompt: characterProfileCompressorPromptLoader,
} satisfies Record<string, PromptLoader>;

export type LoadedPrompts = Record<keyof typeof promptLoaderDefinitions, string>;

export async function loadPrompts(storyId: string | undefined, storyName: string | undefined): Promise<LoadedPrompts> {
	type Keys = keyof typeof promptLoaderDefinitions;
	const keys = Object.keys(promptLoaderDefinitions) as Keys[];

	const values = await Promise.all(
		storyId && storyName
			? keys.map((key) => promptLoaderDefinitions[key].loadByStory(storyId, storyName))
			: keys.map((key) => promptLoaderDefinitions[key].loadDefault())
	);

	return Object.fromEntries(keys.map((key, i) => [key, values[i]])) as LoadedPrompts;
}
