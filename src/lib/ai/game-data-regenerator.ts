import { generateText } from 'ai';
import type { MessageBase } from '$lib/db/messages';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { createModel } from './provider';
import type { GameDataFields, NarrativeVariables } from './narrative-types';
import { emptyGameDataFields } from './narrative-types';
import { parseContent } from '$lib/utils/chat-stream-parser';
import { variablesToMarkdown } from './template-renderer';
import { getGameMasterDescriptors } from './descriptors';
import { gameMasterSystemPromptLoader } from '$lib/fs/prompts';
import {
	SECTION,
	formatPreviousNarrativeBody,
	formatTurnOfEventsSection,
	formatDirectorNotesSection,
} from '$lib/definitions/pipeline-sections';
import { gameMasterExtractionPrompt } from '$lib/definitions/pipeline-prompts';

export interface GameDataRegenerationContext {
	worldContent: string;
	actPlot: string;
	actSummary: string;
	directorNotes: string;
	sceneNumber: number;
	narrativeVariables: NarrativeVariables;
	playerResponse: string | null;
}

/**
 * Regenerate GameData for an existing message using non-streaming GM phase.
 * Used when enriching a forked message with turnOfEvents.
 */
export async function regenerateGameData(params: GameDataRegenerationContext): Promise<GameDataFields | null> {
	const { worldContent, actPlot, actSummary, directorNotes, narrativeVariables, playerResponse, sceneNumber } = params;
	const config = getMainProviderConfig();
	if (!config?.model) return null;

	const gameMasterSystemPrompt = await gameMasterSystemPromptLoader.loadDefault();

	const model = await createModel(config);
	const editorOutput = variablesToMarkdown(narrativeVariables);

	const contents = [
		SECTION.WORLD_CONTENT + worldContent,
		SECTION.ACT_PLOT + actPlot,
		SECTION.ACT_SUMMARY + actSummary,
		...formatPreviousNarrativeBody(narrativeVariables.narrativeBody, sceneNumber),
		...(playerResponse ? [SECTION.PLAYER_RESPONSE + playerResponse] : []),
		...formatTurnOfEventsSection(narrativeVariables.turnOfEvents),
		SECTION.EDITOR_OUTPUT + editorOutput,
		...formatDirectorNotesSection(directorNotes),
		gameMasterExtractionPrompt(),
	];

	const messages: MessageBase[] = contents.map((content) => ({ role: 'user' as const, content }));

	const result = await generateText({ model, system: gameMasterSystemPrompt, messages, ...(config.callSettings ?? {}) });
	const gmText = result.text.trim();
	if (!gmText) return null;

	return parseContent<GameDataFields>(gmText, getGameMasterDescriptors(), emptyGameDataFields());
}
