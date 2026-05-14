import { ls } from '$lib/definitions/locale-strings';

/** Label preceding the world building settings card content. */
export const worldCardLabel = () => ls('features.importWorld.labels.worldCard');

/** Label preceding the act card content. */
export const actCardLabel = () => ls('features.importWorld.labels.actCard');

/** Label preceding a character card content. */
export const characterCardLabel = (name: string) => ls('features.importWorld.labels.characterCard', { name });

/** Placeholder for a character name when none is available. */
export const characterNamePlaceholder = () => ls('features.importWorld.labels.characterNamePlaceholder');

/** Final instruction sent to LLM after all context cards. */
export const actGenerationInstruction = () => ls('features.importWorld.instructions.actGeneration');

/** Prompt for the first scene extraction (no prior scenes). */
export const sceneExtractionFirstPrompt = (narrationTemplate: string, sceneContent: string) =>
	ls('features.importWorld.instructions.sceneExtractionFirst', { narrationTemplate, sceneContent });

/** Prompt for subsequent scene extraction (with prior scenes as history). */
export const sceneExtractionContinuationPrompt = (previousScenes: string, narrationTemplate: string, sceneContent: string) =>
	ls('features.importWorld.instructions.sceneExtractionContinuation', { previousScenes, narrationTemplate, sceneContent });
