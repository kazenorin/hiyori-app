import { ls } from '$lib/localization';

/** Marks the start of an act transcript in LLM messages (for act card generation). */
export const actCardTranscriptStart = () => ls('features.actCardGenerator.transcriptStart');

/** Combined end-of-transcript + template intro for act card generation. */
export const actCardTranscriptEnd = () => ls('features.actCardGenerator.transcriptEnd');

/** Labels world content for LLM context. */
export const worldContextLabel = () => ls('features.actCardGenerator.worldContext');

/** System prompt for act card generation. */
export const actCardSystemPrompt = () => ls('features.actCardGenerator.systemPrompt');

/** Extraction instructions for act card generation. */
export const actCardExtractionPrompt = () => ls('features.actCardGenerator.extractionPrompt');
