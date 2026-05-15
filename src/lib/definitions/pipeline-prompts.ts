import { ls } from '$lib/localization';

// Headers
export const sceneSummariesHeader = () => ls('pipeline.headers.sceneSummaries');
export const characterSummariesHeader = () => ls('pipeline.headers.characterSummaries');

// Labels
export const acceptAsIsLabel = () => ls('pipeline.labels.acceptAsIs');
export const totalViolationsLabel = () => ls('pipeline.labels.totalViolations');
export const recommendationLabel = () => ls('pipeline.labels.recommendation');

// System prompts
export const templateFitterSystemPrompt = () => ls('pipeline.system.templateFitter');

// Extraction prompts
export const gameMasterExtractionPrompt = () => ls('pipeline.extraction.gameMaster');
export const editorExtractionPrompt = () => ls('pipeline.extraction.editor');
export const editorTemplateFitterExtractionPrompt = () => ls('pipeline.extraction.editorTemplateFitter');
export const gmTemplateFitterExtractionPrompt = () => ls('pipeline.extraction.gmTemplateFitter');

export const reviewerExtractionPromptTemplate = (currentScene: number | string) => ls('pipeline.extraction.reviewer', { currentScene });
export const writerExtractionPromptTemplate = (currentScene: number | string) => ls('pipeline.extraction.writer', { currentScene });
export const plotPlannerExtractionPromptTemplate = (currentScene: number | string) =>
	ls('pipeline.extraction.plotPlanner', { currentScene });
export const summarizerFallbackExtractionPromptTemplate = (completedScenes: number | string) =>
	ls('pipeline.extraction.summarizerFallback', { completedScenes });
export const summarizerExtractionPromptTemplate = (completedScenes: number | string, sceneTitle: string) =>
	ls('pipeline.extraction.summarizer', { completedScenes, sceneTitle });
