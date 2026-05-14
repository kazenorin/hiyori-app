import { ls } from '$lib/localization';

/** Marks the start of an act transcript in LLM messages. */
export const transcriptStart = () => ls('features.characterCardGenerator.transcriptStart');

/** Marks the end of an act transcript in LLM messages. */
export const transcriptEnd = () => ls('features.characterCardGenerator.transcriptEnd');

/** Labels an act card in LLM context. */
export const actCardLabel = (actNumber: number) => ls('features.characterCardGenerator.actCard', { actNumber });

/** Labels a character card from a previous act in LLM context. */
export const characterCardLabel = (characterName: string, actNumber: number) =>
	ls('features.characterCardGenerator.characterCard', { characterName, actNumber });

/** Prefix for the character extraction user message. */
export const characterExtractionPrefix = () =>
	ls('features.characterCardGenerator.characterExtractionPrefix', {
		transcriptStart: transcriptStart(),
	});

/** Instruction suffix for character extraction. */
export const characterExtractionInstruction = (rules: string) => ls('features.characterCardGenerator.characterExtraction', { rules });

/** Instruction for character card generation. */
export const characterCardGenerationInstruction = (extractionPrompt: string, template: string) =>
	ls('features.characterCardGenerator.characterCardGeneration', { extractionPrompt, template });
