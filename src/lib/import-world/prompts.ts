import { ls } from '$lib/definitions/locale-strings';

/** Label preceding the world building settings card content. */
export const worldCardLabel = () => ls('importWorld.labels.worldCard');

/** Label preceding the act card content. */
export const actCardLabel = () => ls('importWorld.labels.actCard');

/** Label preceding a character card content. */
export const characterCardLabel = (name: string) => ls('importWorld.labels.characterCard', { name });

/** Final instruction sent to LLM after all context cards. */
export const actGenerationInstruction = () => ls('importWorld.instructions.actGeneration');

/** Prompt for the first scene extraction (no prior scenes). */
export const sceneExtractionFirstPrompt = (narrationTemplate: string, sceneContent: string) =>
	ls('importWorld.instructions.sceneExtractionFirst', { narrationTemplate, sceneContent });

/** Prompt for subsequent scene extraction (with prior scenes as history). */
export const sceneExtractionContinuationPrompt = (previousScenes: string, narrationTemplate: string, sceneContent: string) =>
	ls('importWorld.instructions.sceneExtractionContinuation', { previousScenes, narrationTemplate, sceneContent });
