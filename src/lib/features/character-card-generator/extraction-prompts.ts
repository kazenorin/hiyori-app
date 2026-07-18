import { ls } from '$lib/localization';

/** System prompt for character extraction. */
export const characterExtractionSystemPrompt = () => ls('features.characterCardGenerator.characterExtraction.systemPrompt');

/** Combined extraction instruction with rules for extracting characters from an act. */
export const characterExtractionPrompt = () => ls('features.characterCardGenerator.characterExtraction.extractionPrompt');

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
	ls('features.characterCardGenerator.characterExtraction.prefix', {
		transcriptStart: transcriptStart(),
	});

/** Instruction suffix for character card generation. */
export const characterCardGenerationInstruction = (extractionRules: string, template: string) =>
	ls('features.characterCardGenerator.characterCardGeneration', { extractionRules, template });

/** System prompt for character card generation (specific character). */
export const characterCardGenerationSystemPrompt = (characterName: string) =>
	ls('features.characterCardGenerator.cardGenerationSystemPrompt', { characterName });
