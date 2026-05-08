import type { OutputDescriptor } from '$lib/chat-stream-parser/types';

/** Scene header descriptors — used by WRITER and EDITOR phases. */
export const SCENE_DESCRIPTORS: OutputDescriptor[] = [
	{ outputPath: 'sceneTitle', match: { type: 'header', content: 'Scene title' }, bodyOnly: true, currentLevelOnly: true },
	{ outputPath: 'background', match: { type: 'header', content: 'Background' }, bodyOnly: true },
	{ outputPath: 'narrativeBody', match: { type: 'header', content: 'Narrative Body' }, bodyOnly: true },
	{ outputPath: 'cg', match: { type: 'header', content: 'CG' }, bodyOnly: true },
];

/**
 * Game Data descriptors — used by GAME_MASTER phase and combined with scene descriptors for WRITER.
 * Uses flat outputPath (not gameData.xxx) because lodash set() with dot notation
 * would overwrite the gameData object. The narrative-stream-parser assembles GameDataFields.
 */
export const GAME_DATA_DESCRIPTORS: OutputDescriptor[] = [
	{
		outputPath: 'activePlotThreads',
		match: { type: 'list', listIndex: 0, parent: { type: 'header', content: 'Active Plot Threads' } },
		bodyOnly: true,
	},
	{ outputPath: 'decisionContext', match: { type: 'header', content: 'Decision Context' }, bodyOnly: true, currentLevelOnly: true },
	{ outputPath: 'decisions', match: { type: 'list', listIndex: 0, parent: { type: 'header', content: 'Decisions' } }, bodyOnly: true },
];

/** Combined descriptors for WRITER phase (scene fields + game data). */
export const NARRATIVE_DESCRIPTORS: OutputDescriptor[] = [...SCENE_DESCRIPTORS, ...GAME_DATA_DESCRIPTORS];

/** Game Master phase — only game data extraction. */
export const GAME_MASTER_DESCRIPTORS: OutputDescriptor[] = GAME_DATA_DESCRIPTORS;

/** Reviewer phase — no variable extraction needed. */
export const REVIEWER_DESCRIPTORS: OutputDescriptor[] = [];

/** Editor phase — scene fields only (game data comes from GM phase). */
export const EDITOR_DESCRIPTORS: OutputDescriptor[] = SCENE_DESCRIPTORS;
