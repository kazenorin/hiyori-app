import { ls } from '$lib/localization';
import { ACT_PHASE_LOCALE_KEYS, type PlotMode, type ActPhase } from '$lib/ai/narrative-types';

// Headers
export const sceneSummariesHeader = () => ls('pipeline.headers.sceneSummaries');
export const characterSummariesHeader = () => ls('pipeline.headers.characterSummaries');
export const characterProfilesHeader = () => ls('pipeline.headers.characterProfiles');

// Labels
export const acceptAsIsLabel = () => ls('pipeline.labels.acceptAsIs');
export const totalViolationsLabel = () => ls('pipeline.labels.totalViolations');
export const recommendationLabel = () => ls('pipeline.labels.recommendation');
export const characterSummariesSinceSceneLabel = (sceneNumber: number) => ls('pipeline.labels.characterSummaries', { sceneNumber });

/** Localized display name for an act phase (e.g., 'rising-action' → 'Rising Action'). */
export const getLocalizedActPhase = (phase: ActPhase): string =>
	ls(`pipeline.labels.actPhases.${ACT_PHASE_LOCALE_KEYS[phase]}`);

// System prompts
export const templateFitterSystemPrompt = () => ls('pipeline.system.templateFitter');

// Extraction prompts
export const gameMasterExtractionPrompt = () => ls('pipeline.extraction.gameMaster');
export const editorExtractionPrompt = () => ls('pipeline.extraction.editor');
export const editorTemplateFitterExtractionPrompt = () => ls('pipeline.extraction.editorTemplateFitter');
export const gmTemplateFitterExtractionPrompt = () => ls('pipeline.extraction.gmTemplateFitter');

export const reviewerExtractionPromptTemplate = (currentScene: number | string) => ls('pipeline.extraction.reviewer', { currentScene });
export const quickReviewerExtractionPromptTemplate = (currentScene: number | string) =>
	ls('pipeline.extraction.reviewerQuick', { currentScene });
export const writerExtractionPromptTemplate = (currentScene: number | string) => ls('pipeline.extraction.writer', { currentScene });
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
export const summarizerExtractionPromptTemplate = (completedScenes: number | string, sceneTitle: string) =>
	ls('pipeline.extraction.summarizer', { completedScenes, sceneTitle });
