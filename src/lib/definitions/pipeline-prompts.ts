import { ls } from './locale-strings';

export const gameMasterExtractionPrompt = () => ls('staticPrompts.extraction.gameMaster');

export const editorExtractionPrompt = () => ls('staticPrompts.extraction.editor');

export const reviewerExtractionPromptTemplate = (currentScene: number | string) =>
	ls('staticPrompts.extraction.reviewer', { currentScene });

export const writerExtractionPromptTemplate = (currentScene: number | string) => ls('staticPrompts.extraction.writer', { currentScene });

export const plotPlannerExtractionPromptTemplate = (currentScene: number | string) =>
	ls('staticPrompts.extraction.plotPlanner', { currentScene });

export const summarizerFallbackExtractionPromptTemplate = (completedScenes: number | string) =>
	ls('staticPrompts.extraction.summarizerFallback', { completedScenes });

export const summarizerExtractionPromptTemplate = (completedScenes: number | string, sceneTitle: string) =>
	ls('staticPrompts.extraction.summarizer', { completedScenes, sceneTitle });

export const templateFitterSystemPrompt = () => ls('staticPrompts.system.templateFitter');

export const editorTemplateFitterExtractionPrompt = () => ls('staticPrompts.extraction.editorTemplateFitter');

export const gmTemplateFitterExtractionPrompt = () => ls('staticPrompts.extraction.gmTemplateFitter');
