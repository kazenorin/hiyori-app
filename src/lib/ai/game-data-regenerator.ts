import { generateText } from 'ai';
import type { MessageBase } from '$lib/db/messages';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { createModel } from './provider';
import type { GameDataFields, NarrativeVariables } from './narrative-types';
import { emptyGameDataFields } from './narrative-types';
import { parseContent } from '$lib/chat-stream-parser';
import { variablesToMarkdown } from './template-renderer';
import { GAME_MASTER_DESCRIPTORS } from './descriptors';
import { gameMasterSystemPromptLoader } from '$lib/fs/prompts';
import { SECTION, formatPreviousNarrativeBody, formatTurnOfEventsSection } from '$lib/definitions/section-constants';
import { gameMasterExtractionPrompt } from '$lib/definitions/static-prompts';

export interface GameDataRegenerationContext {
	worldContent: string;
	actPlot: string;
	actSummary: string;
	sceneNumber: number;
	narrativeVariables: NarrativeVariables;
	playerResponse: string | null;
}

/**
 * Regenerate GameData for an existing message using non-streaming GM phase.
 * Used when enriching a forked message with turnOfEvents.
 */
export async function regenerateGameData(params: GameDataRegenerationContext): Promise<GameDataFields | null> {
	const { worldContent, actPlot, actSummary, narrativeVariables, playerResponse, sceneNumber } = params;
	const config = getMainProviderConfig();
	if (!config?.apiKey) return null;

	const gameMasterSystemPrompt = await gameMasterSystemPromptLoader.loadDefault();

	const model = createModel(config);
	const editorOutput = variablesToMarkdown(narrativeVariables);

	const contents = [
		SECTION.WORLD_CONTENT + worldContent,
		SECTION.ACT_PLOT + actPlot,
		SECTION.ACT_SUMMARY + actSummary,
		...formatPreviousNarrativeBody(narrativeVariables.narrativeBody, sceneNumber),
		...(playerResponse ? [SECTION.PLAYER_RESPONSE + playerResponse] : []),
		...formatTurnOfEventsSection(narrativeVariables.turnOfEvents),
		SECTION.EDITOR_OUTPUT + editorOutput,
		gameMasterExtractionPrompt,
	];

	const messages: MessageBase[] = contents.map((content) => ({ role: 'user' as const, content }));

	const result = await generateText({ model, system: gameMasterSystemPrompt, messages });
	const gmText = result.text.trim();
	if (!gmText) return null;

	return parseContent<GameDataFields>(gmText, GAME_MASTER_DESCRIPTORS, emptyGameDataFields());
}
