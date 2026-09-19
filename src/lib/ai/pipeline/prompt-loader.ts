import {
	characterProfileCompressorPromptLoader,
	editorExtractionPromptLoader,
	epilogueWriterExtractionPromptLoader,
	guidanceGameMasterExtractionPromptLoader,
	guidancePlotPlannerExtractionPromptLoader,
	guidanceWriterExtractionPromptLoader,
	generalInstructionsLoader,
	mainChatSystemPromptLoader,
	phaseEventGameMasterExtractionPromptLoader,
	phaseEventPlotPlannerExtractionPromptLoader,
	phaseEventWriterExtractionPromptLoader,
	type PromptLoader,
	quickReviewerExtractionPromptLoader,
	reviewerExtractionPromptLoader,
	summarizerIncrementalPromptLoader,
	summarizerPromptLoader,
	writerOutputTemplateLoader,
	writerRoleLoader,
} from '$lib/fs/prompts';

const promptLoaderDefinitions = {
	generalInstructions: generalInstructionsLoader,
	mainChatSystemPrompt: mainChatSystemPromptLoader,
	writerOutputTemplate: writerOutputTemplateLoader,
	writerRole: writerRoleLoader,
	guidanceWriterExtractionPrompt: guidanceWriterExtractionPromptLoader,
	phaseEventWriterExtractionPrompt: phaseEventWriterExtractionPromptLoader,
	epilogueWriterExtractionPrompt: epilogueWriterExtractionPromptLoader,
	reviewerExtractionPrompt: reviewerExtractionPromptLoader,
	quickReviewerExtractionPrompt: quickReviewerExtractionPromptLoader,
	editorExtractionPrompt: editorExtractionPromptLoader,
	guidancePlotPlannerExtractionPrompt: guidancePlotPlannerExtractionPromptLoader,
	phaseEventPlotPlannerExtractionPrompt: phaseEventPlotPlannerExtractionPromptLoader,
	guidanceGameMasterExtractionPrompt: guidanceGameMasterExtractionPromptLoader,
	phaseEventGameMasterExtractionPrompt: phaseEventGameMasterExtractionPromptLoader,
	summarizerPrompt: summarizerPromptLoader,
	summarizerIncrementalPrompt: summarizerIncrementalPromptLoader,
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
