import { ls } from '$lib/localization';

// === Character Card Generator ===

export const characterCardCoreIdentityLabel = () => ls('features.characterCardGenerator.coreIdentity');

export const characterCardExtractionRules = (characterName: string) => ls('features.characterCardGenerator.cardExtractionRules', { characterName });

// === World Builder ===

export const actPlotInterviewExtractionPrompt = () => ls('features.worldBuilder.actPlotInterviewExtraction');

// === Interview ===

export const interviewSystemRolePreGame = () => ls('features.interview.systemRole.preGame');

export const interviewSystemRoleNextAct = () => ls('features.interview.systemRole.nextAct');

export const interviewPreviousActConclusion = (endingType: string) => ls('features.interview.previousActConclusion', { endingType });

export const interviewNextActPurpose = (endingType: string) => ls('features.interview.nextActInterviewPurpose', { endingType });

// === World Generator ===

export const worldFromChatSystemPrompt = () => ls('features.worldGenerator.fromChatSystemPrompt');

export const worldFromChatPrompt = () => ls('features.worldGenerator.fromChatPrompt');

export const worldFromCardsSystemPrompt = () => ls('features.worldGenerator.fromCardsSystemPrompt');

export const worldFromCardsPrompt = () => ls('features.worldGenerator.fromCardsPrompt');

// === World Updater ===

export const worldFromActSystemPrompt = () => ls('features.worldUpdater.fromActSystemPrompt');

export const worldFromActPrompt = () => ls('features.worldUpdater.fromActPrompt');

// === Important Phrases ===

export const importantPhrasesSystemPrompt = () => ls('features.importantPhrases.systemPrompt');

// === Import World ===

export const importWorldUnnamedCharacter = () => ls('features.importWorld.description.unnamedCharacter');

export const importWorldCompleteWithInterview = () => ls('features.importWorld.messages.importCompleteWithInterview');

export const importWorldComplete = () => ls('features.importWorld.messages.importComplete');

export const importWorldCompletedSuccessfully = () => ls('features.importWorld.messages.importCompletedSuccessfully');

export const importWorldFailed = () => ls('features.importWorld.messages.importFailed');

export const importWorldProcessingAct = (actNumber: number) => ls('features.importWorld.messages.processingAct', { actNumber });

export const importWorldFillingNarrativeVariables = (count: number) =>
	ls('features.importWorld.messages.fillingNarrativeVariables', { count });

export const importWorldFillingNarrativeVariable = (index: number) =>
	ls('features.importWorld.messages.fillingNarrativeVariable', { index });

// Import World Validations

export const importValStoryNameEmpty = () => ls('features.importWorld.validations.storyNameEmpty');

export const importValActTranscriptRequired = (actNumber: number) =>
	ls('features.importWorld.validations.actTranscriptRequired', { actNumber });

export const importValActTranscriptRequiredSingle = () => ls('features.importWorld.validations.actTranscriptRequiredSingle');

export const importValLastActRequiresContent = () => ls('features.importWorld.validations.lastActRequiresContent');

export const importValActNameEmpty = (actNumber: number) => ls('features.importWorld.validations.actNameEmpty', { actNumber });

export const importValCharacterCardMissing = () => ls('features.importWorld.validations.characterCardMissing');

export const importValCharacterNameEmpty = () => ls('features.importWorld.validations.characterNameEmpty');

export const importValFileTooLarge = (field: string, size: string | number, max: string | number) =>
	ls('features.importWorld.validations.fileTooLarge', { field, size, max });

export const importValContentRequired = () => ls('features.importWorld.validations.contentRequired');

export const importValRetryCountRange = () => ls('features.importWorld.validations.retryCountRange');

export const importValBackoffIntervalRange = () => ls('features.importWorld.validations.backoffIntervalRange');

export const importValFileMustBeMdOrTxt = (field: string) => ls('features.importWorld.validations.fileMustBeMdOrTxt', { field });

export const importValFileMustBeJson = () => ls('features.importWorld.validations.fileMustBeJson');
