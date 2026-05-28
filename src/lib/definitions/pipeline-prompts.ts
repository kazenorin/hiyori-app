import { ls } from '$lib/localization';
import { ACT_PHASE_LOCALE_KEYS, type PlotMode, type ActPhase } from '$lib/ai/narrative-types';

// Headers
export const sceneSummariesHeader = () => ls('pipeline.headers.sceneSummaries');
export const characterSummariesHeader = () => ls('pipeline.headers.characterSummaries');
export const characterProfilesHeader = () => ls('pipeline.headers.characterProfiles');

// Labels
export const upToLabel = () => ls('pipeline.labels.upTo');
export const acceptAsIsLabel = () => ls('pipeline.labels.acceptAsIs');
export const totalViolationsLabel = () => ls('pipeline.labels.totalViolations');
export const recommendationLabel = () => ls('pipeline.labels.recommendation');
export const stateLabel = () => ls('pipeline.labels.state');
export const goalLabel = () => ls('pipeline.labels.goal');
export const relationshipsLabel = () => ls('pipeline.labels.relationships');
export const voiceLabel = () => ls('pipeline.labels.voice');
export const sceneCountLabel = (n: number) =>
	n === 1 ? ls('pipeline.labels.sceneCountSingular') : ls('pipeline.labels.sceneCountPlural', { count: n });
export const characterSummariesSinceSceneLabel = (sceneNumber: number) => ls('pipeline.labels.characterSummaries', { sceneNumber });

/** Localized display name for an act phase (e.g., 'rising-action' → 'Rising Action'). */
export const getLocalizedActPhase = (phase: ActPhase): string => ls(`pipeline.labels.actPhases.${ACT_PHASE_LOCALE_KEYS[phase]}`);

// System prompts
export const templateFitterSystemPrompt = () => ls('pipeline.system.templateFitter');

// Extraction prompts
export const gameMasterExtractionPrompt = () => ls('pipeline.extraction.gameMaster');
export const gmPhaseEventAdvancementTrigger = (actPhase: string) =>
	ls('pipeline.extraction.gmPhaseEventPhaseAdvancementTrigger', { actPhase });
export const gmActEndTrigger = () => ls('pipeline.extraction.gmActEndTrigger');
export const editorExtractionPrompt = () => ls('pipeline.extraction.editor');
export const editorTemplateFitterExtractionPrompt = () => ls('pipeline.extraction.editorTemplateFitter');
export const gmTemplateFitterExtractionPrompt = () => ls('pipeline.extraction.gmTemplateFitter');
export const aliasFilterExtractionPrompt = () => ls('pipeline.extraction.aliasFilter');
export const actShortSummaryExtractionPrompt = () => ls('pipeline.extraction.actShortSummary');
export const actShortSummaryCharacterPrefix = () => ls('pipeline.extraction.actShortSummaryCharacterPrefix');
export const actPlotResumeNote = (sceneNumber: number | string) => ls('pipeline.extraction.actPlotResumeNote', { sceneNumber });

export const reviewerExtractionPromptTemplate = (currentScene: number | string) => ls('pipeline.extraction.reviewer', { currentScene });
export const quickReviewerExtractionPromptTemplate = (currentScene: number | string) =>
	ls('pipeline.extraction.reviewerQuick', { currentScene });
export const guidancePlotPlannerExtractionPromptTemplate = (currentScene: number | string) =>
	ls('pipeline.extraction.plotPlanner.guidance', { currentScene });
export const phaseEventPlotPlannerExtractionPromptTemplate = (actPhase: ActPhase) =>
	ls('pipeline.extraction.plotPlanner.phaseEvent', { currentActPhase: getLocalizedActPhase(actPhase) });
export const plotPlannerExtractionPrompt = (plotMode: PlotMode, currentScene: number | string, actPhase?: ActPhase | null) =>
	plotMode === 'phaseEvent'
		? phaseEventPlotPlannerExtractionPromptTemplate(actPhase ?? 'introduction')
		: guidancePlotPlannerExtractionPromptTemplate(currentScene);
export const summarizerFallbackExtractionPromptTemplate = (completedScenes: number | string) =>
	ls('pipeline.extraction.summarizerFallback', { completedScenes });
export const summarizerFullExtractionPromptTemplate = () => ls('pipeline.extraction.summarizerFull');
export const summarizerExtractionPromptTemplate = (completedScenes: number | string, sceneTitle: string) =>
	ls('pipeline.extraction.summarizer', { completedScenes, sceneTitle });

export const summarizerTranscriptStart = () => ls('pipeline.extraction.summarizerTranscriptStart');
export const summarizerTranscriptEnd = () => ls('pipeline.extraction.summarizerTranscriptEnd');

// Writer sub-prompts
export const writerProvidedSummary = (summarizedScenes: number) => ls('pipeline.extraction.writer.providedSummary', { summarizedScenes });
export const writerProvidedTurnOfEvents = () => ls('pipeline.extraction.writer.providedTurnOfEvents');
export const writerTurnOfEventsReinforcementPhrase = () => ls('pipeline.extraction.writer.turnOfEventsReinforcementPhrase');
export const writerProvidedDirectorNotes = () => ls('pipeline.extraction.writer.providedDirectorNotes');
export const writerDirectorNotesReinforcementPhrase = () => ls('pipeline.extraction.writer.directorNotesReinforcementPhrase');
export const writerClosingSceneRules = () => ls('pipeline.extraction.writer.closingSceneRules');
export const writerActEndPhaseEvent = (params: { closingSceneRules: string; endingTypeInstructions: string }) =>
	ls('pipeline.extraction.writer.actEndPhaseEvent', params);
export const writerActEndGuidance = (params: { closingSceneRules: string; endingTypeInstructions: string }) =>
	ls('pipeline.extraction.writer.actEndGuidance', params);
export const writerEpilogueExtractionPrompt = (endingType: string) => ls('pipeline.extraction.writer.epilogue', { endingType });
export const writerGuidanceExtractionPrompt = () => ls('pipeline.extraction.writer.guidanceExtraction');
export const writerPhaseEventExtractionPrompt = () => ls('pipeline.extraction.writer.phaseEventExtraction');
export const actSummaryIncrementalTemplate = () => ls('pipeline.extraction.actSummaryIncrementalTemplate');
