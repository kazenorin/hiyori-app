import { ls } from '#lib/localization/index.ts';
import { aliasesLabel } from './common-labels';
import { ACT_PHASE_LOCALE_KEYS, type ActPhase } from '#lib/ai/narrative-types.ts';
import type { BackgroundContextMode, CharacterProfileUpdateMethod } from '#lib/stores/settings.svelte.ts';

// Headers
export const sceneSummariesHeader = () => ls('pipeline.headers.sceneSummaries');
export const characterSummariesHeader = () => ls('pipeline.headers.characterSummaries');
export const characterProfilesHeader = () => ls('pipeline.headers.characterProfiles');
export const characterProfileUpdatesHeader = () => ls('pipeline.headers.characterProfileUpdates');
export const clearFieldsHeader = () => ls('pipeline.headers.clearFields');

// Labels
export const upToLabel = () => ls('pipeline.labels.upTo');
export const acceptAsIsLabel = () => ls('pipeline.labels.acceptAsIs');
export const totalViolationsLabel = () => ls('pipeline.labels.totalViolations');
export const recommendationLabel = () => ls('pipeline.labels.recommendation');
export const preferredNameLabel = () => ls('pipeline.labels.preferredName');
export const stateLabel = () => ls('pipeline.labels.state');
export const loglineLabel = () => ls('pipeline.labels.logline');
export const goalLabel = () => ls('pipeline.labels.goal');
export const relationshipsLabel = () => ls('pipeline.labels.relationships');
export const voiceLabel = () => ls('pipeline.labels.voice');
export const traitsLabel = () => ls('pipeline.labels.traits');
export const importanceLabel = () => ls('pipeline.labels.importance');
export const updateCountLabel = () => ls('pipeline.labels.updateCount');
export const importanceLevelLabel = (level: 1 | 2 | 3 | 4) => ls(`pipeline.labels.importanceLevels.${level}`);
export const sceneCountLabel = (n: number) =>
	n === 1 ? ls('pipeline.labels.sceneCountSingular') : ls('pipeline.labels.sceneCountPlural', { count: n });
export const lastSeenLabel = (sceneNumber: number) => ls('pipeline.labels.lastSeen', { sceneNumber });
export const lastUpdatedLabel = (sceneNumber: number) => ls('pipeline.labels.lastUpdated', { sceneNumber });
export const importanceValueLabel = (importance: string) => ls('pipeline.labels.importanceValue', { importance });
export const aliasesValueLabel = (aliases: string) => ls('pipeline.labels.aliasesValue', { aliases });

/** Labels for one structured character-profile update batch, captured once per compression. */
export function getProfileUpdateLabels() {
	return {
		envelope: characterProfileUpdatesHeader(),
		count: updateCountLabel(),
		clearFields: clearFieldsHeader(),
		fields: {
			preferredName: preferredNameLabel(),
			logline: loglineLabel(),
			state: stateLabel(),
			goal: goalLabel(),
			relationships: relationshipsLabel(),
			voice: voiceLabel(),
			importance: importanceLabel(),
			aliases: aliasesLabel(),
			traits: traitsLabel(),
		},
	};
}
export type ProfileUpdateLabels = ReturnType<typeof getProfileUpdateLabels>;

function profileLabelParams(labels: ProfileUpdateLabels): Record<string, string> {
	return {
		envelope: labels.envelope,
		count: labels.count,
		clearFields: labels.clearFields,
		...labels.fields,
	};
}

/** Single resolved output-transport contract for the configured update method. */
export function profileUpdateContract(method: CharacterProfileUpdateMethod, labels: ProfileUpdateLabels): string {
	const key = method === 'toolCalls' ? 'pipeline.compressor.transport.toolCalls' : 'pipeline.compressor.transport.structuredMarkdown';
	return ls(key, profileLabelParams(labels));
}

/** Instructions for repairing a rejected structured-Markdown batch without inventing or dropping data. */
export function profileUpdateRepairInstructions(labels: ProfileUpdateLabels): string {
	return ls('pipeline.extraction.characterProfileRepair', profileLabelParams(labels));
}
export const noDescriptionLabel = () => ls('pipeline.labels.noDescription');
export const sceneDetailsLabel = () => ls('pipeline.labels.sceneDetails');
export const canonicalNameLabel = () => ls('pipeline.labels.canonicalName');
export const characterSummariesSinceSceneLabel = (sceneNumber: number) => ls('pipeline.labels.characterSummaries', { sceneNumber });
export const plotPlannerEstimatedLengthLabel = () => ls('pipeline.labels.plotPlanner.estimatedLength');

/** Localized display name for an act phase (e.g., 'rising-action' → 'Rising Action'). */
export const getLocalizedActPhase = (phase: ActPhase): string => ls(`pipeline.labels.actPhases.${ACT_PHASE_LOCALE_KEYS[phase]}`);

// System prompts
export const templateFitterSystemPrompt = () => ls('pipeline.system.templateFitter');

/** Resolve the single shared system prompt (persona + general instructions + tools note). */
export function resolveSharedSystemPrompt(prompts: { mainChatSystemPrompt: string; generalInstructions: string }): string {
	return prompts.mainChatSystemPrompt.replaceAll('{{generalInstructions}}', prompts.generalInstructions);
}

const LAYOUT_SLOT_KEYS = {
	'{{layoutFullAnalyzeInputs}}': 'pipeline.layoutSlots.fullAnalyzeInputs',
	'{{layoutFullSceneSummaries}}': 'pipeline.layoutSlots.fullSceneSummaries',
	'{{layoutIncrementalAnalyzeInputs}}': 'pipeline.layoutSlots.incrementalAnalyzeInputs',
	'{{layoutIncrementalScope}}': 'pipeline.layoutSlots.incrementalScope',
	'{{layoutCompressorSources}}': 'pipeline.layoutSlots.compressorSources',
} as const;

/** Fill the layout-dependent prompt spans for the background context mode. */
export function applyLayoutSlots(prompt: string, mode: BackgroundContextMode): string {
	let result = prompt;
	for (const [placeholder, key] of Object.entries(LAYOUT_SLOT_KEYS)) {
		result = result.replaceAll(placeholder, ls(`${key}.${mode}`));
	}
	return result;
}

// Extraction prompts
export const editorTemplateFitterExtractionPrompt = () => ls('pipeline.extraction.editorTemplateFitter');
export const gmTemplateFitterExtractionPrompt = () => ls('pipeline.extraction.gmTemplateFitter');
export const aliasFilterExtractionPrompt = () => ls('pipeline.extraction.aliasFilter');
export const actShortSummaryExtractionPrompt = () => ls('pipeline.extraction.actShortSummary');
export const actShortSummaryCharacterPrefix = () => ls('pipeline.extraction.actShortSummaryCharacterPrefix');
export const actPlotResumeNote = (sceneNumber: number | string) => ls('pipeline.extraction.actPlotResumeNote', { sceneNumber });
export const actPlotTailoredExperience = () => ls('pipeline.extraction.actPlotTailoredExperience');
export const actPlotDescription = () => ls('pipeline.extraction.actPlotDescription');
export const upcomingScenePlotGuidanceDescription = () => ls('pipeline.extraction.upcomingScenePlotDescription.guidance');
export const upcomingScenePlotPhaseEventDescription = () => ls('pipeline.extraction.upcomingScenePlotDescription.phaseEvent');

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
export const writerScenePrioritiesHeader = () => ls('pipeline.extraction.writer.scenePrioritiesHeader');
export const writerClosingSceneRules = () => ls('pipeline.extraction.writer.closingSceneRules');
export const writerActEndPhaseEvent = (params: { closingSceneRules: string; endingTypeInstructions: string }) =>
	ls('pipeline.extraction.writer.actEndPhaseEvent', params);
export const writerActEndGuidance = (params: { closingSceneRules: string; endingTypeInstructions: string }) =>
	ls('pipeline.extraction.writer.actEndGuidance', params);
export const actSummaryTemplate = () => ls('pipeline.extraction.actSummaryTemplate');
export const plotPlannerEstimateRequirement = () => ls('pipeline.extraction.plotPlanner.estimatedLengthRequirement');

// Memory tools conditional instructions
export const writerMemoryToolsInstruction = () => ls('pipeline.memoryTools.writer');
export const reviewerMemoryToolsInstruction = () => ls('pipeline.memoryTools.reviewer');
export const quickReviewerMemoryToolsInstruction = () => ls('pipeline.memoryTools.quickReviewer');
export const plotPlannerMemoryToolsInstruction = () => ls('pipeline.memoryTools.plotPlanner');

// Inventory tools conditional instructions
export const writerInventoryToolsInstruction = () => ls('pipeline.inventoryTools.writer');
export const reviewerInventoryToolsInstruction = () => ls('pipeline.inventoryTools.reviewer');
export const quickReviewerInventoryToolsInstruction = () => ls('pipeline.inventoryTools.quickReviewer');
export const plotPlannerInventoryToolsInstruction = () => ls('pipeline.inventoryTools.plotPlanner');
export const gameMasterInventoryToolsInstruction = () => ls('pipeline.inventoryTools.gameMaster');
