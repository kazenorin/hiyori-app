import { ls } from '$lib/localization';

/** Seed message for the world builder interview. */
export const worldBuilderSeed = () => ls('features.worldBuilder.worldBuilderSeed');

/** Hidden prompt that asks the LLM to compile the world builder conversation into the final world document. */
export const worldBuilderExtractionPrompt = () => ls('features.worldBuilder.worldBuilderExtractionPrompt');

/** Prefix for resuming a story act interview. */
export const resumeStoryActPrefix = () => ls('features.worldBuilder.resumeStoryActPrefix');

/** Suffix for resuming a story act interview. */
export const resumeStoryActSuffix = () => ls('features.worldBuilder.resumeStoryActSuffix');
