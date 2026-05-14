import { ls } from './locale-strings';

export const gameMasterExtractionPrompt = () => ls('pipeline.extraction.gameMaster');

export const editorExtractionPrompt = () => ls('pipeline.extraction.editor');

export const reviewerExtractionPromptTemplate = (currentScene: number | string) => ls('pipeline.extraction.reviewer', { currentScene });

export const writerExtractionPromptTemplate = (currentScene: number | string) => ls('pipeline.extraction.writer', { currentScene });

export const plotPlannerExtractionPromptTemplate = (currentScene: number | string) =>
	ls('pipeline.extraction.plotPlanner', { currentScene });

export const summarizerFallbackExtractionPromptTemplate = (completedScenes: number | string) =>
	ls('pipeline.extraction.summarizerFallback', { completedScenes });

export const summarizerExtractionPromptTemplate = (completedScenes: number | string, sceneTitle: string) =>
	ls('pipeline.extraction.summarizer', { completedScenes, sceneTitle });

export const templateFitterSystemPrompt = () => ls('pipeline.system.templateFitter');

export const editorTemplateFitterExtractionPrompt = () => ls('pipeline.extraction.editorTemplateFitter');

export const gmTemplateFitterExtractionPrompt = () => ls('pipeline.extraction.gmTemplateFitter');
