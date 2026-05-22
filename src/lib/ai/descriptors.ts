import type { OutputDescriptor } from '$lib/utils/chat-stream-parser/types';
import {
	sceneTitleHeader,
	backgroundHeader,
	narrativeBodyHeader,
	turnOfEventsHeader,
	cgHeader,
	activePlotThreadsHeader,
	decisionContextHeader,
	decisionsHeader,
} from '$lib/definitions/common-headers';

/** Scene header descriptors — used by WRITER and EDITOR phases. */
export function getSceneDescriptors(): OutputDescriptor[] {
	return [
		{ outputPath: 'sceneTitle', match: { type: 'header', content: sceneTitleHeader() }, bodyOnly: true, currentLevelOnly: true },
		{ outputPath: 'background', match: { type: 'header', content: backgroundHeader() }, bodyOnly: true },
		{ outputPath: 'narrativeBody', match: { type: 'header', content: narrativeBodyHeader() }, bodyOnly: true },
		{ outputPath: 'turnOfEvents', match: { type: 'header', content: turnOfEventsHeader() }, bodyOnly: true },
		{ outputPath: 'cg', match: { type: 'header', content: cgHeader() }, bodyOnly: true },
	];
}

/**
 * Game Data descriptors — used by GAME_MASTER phase and combined with scene descriptors for WRITER.
 * Uses flat outputPath (not gameData.xxx) because lodash set() with dot notation
 * would overwrite the gameData object. The narrative-stream-parser assembles GameDataFields.
 */
export function getGameDataDescriptors(): OutputDescriptor[] {
	return [
		{
			outputPath: 'activePlotThreads',
			match: { type: 'list', listIndex: 0, parent: { type: 'header', content: activePlotThreadsHeader() } },
			bodyOnly: true,
		},
		{
			outputPath: 'decisionContext',
			match: { type: 'header', content: decisionContextHeader() },
			bodyOnly: true,
			currentLevelOnly: true,
		},
		{
			outputPath: 'decisions',
			match: { type: 'list', listIndex: 0, parent: { type: 'header', content: decisionsHeader() } },
			bodyOnly: true,
		},
	];
}

/** Combined descriptors for WRITER phase (scene fields + game data). */
export function getNarrativeDescriptors(): OutputDescriptor[] {
	return [...getSceneDescriptors(), ...getGameDataDescriptors()];
}

/** Game Master phase — only game data extraction. */
export function getGameMasterDescriptors(): OutputDescriptor[] {
	return getGameDataDescriptors();
}

/** Reviewer phase — no variable extraction needed. */
export function getReviewerDescriptors(): OutputDescriptor[] {
	return [];
}

/** Editor phase — scene fields only (game data comes from GM phase). */
export function getEditorDescriptors(): OutputDescriptor[] {
	return getSceneDescriptors();
}

/** Plot Planner phase — no variable extraction needed (returns raw content as scenePlot). */
export function getPlotPlannerDescriptors(): OutputDescriptor[] {
	return [];
}

/** Template Fitter for Editor output — scene fields only. */
export function getEditorTemplateFitterDescriptors(): OutputDescriptor[] {
	return getSceneDescriptors();
}

/** Template Fitter for GM output — game data fields only. */
export function getGmTemplateFitterDescriptors(): OutputDescriptor[] {
	return getGameDataDescriptors();
}
