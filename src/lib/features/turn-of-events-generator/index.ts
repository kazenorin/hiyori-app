import { generateText } from 'ai';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { createModel } from '$lib/ai/provider';
import { actPlotInterviewSystemPromptLoader, generalInstructionsLoader, actPlotInterviewTurnOfEventsPromptLoader } from '$lib/fs/prompts';
import { log } from '$lib/logging/logger';
import type { WorldBuilderMessage } from '$lib/features/world-builder/world-builder.svelte';
import { playerLabel, interviewerLabel, sceneWithNumberLabel } from '$lib/definitions/common-labels';
import { actSummaryHeader, currentSceneHeader, interviewTranscriptHeader, sectionFormat } from '$lib/definitions/common-headers';
import { ERR_NO_MAIN_PROVIDER, ERR_EMPTY_TURN_OF_EVENTS } from '$lib/definitions/error-messages';

const LOG_TAG = 'turn-of-events-generator';

const sectionHeaders = {
	get actSummary() {
		return sectionFormat(actSummaryHeader(), 3);
	},
	get currentScene() {
		return sectionFormat(currentSceneHeader(), 3);
	},
	get interviewTranscript() {
		return sectionFormat(interviewTranscriptHeader(), 3);
	},
};

export interface GenerateTurnOfEventsParams {
	storyId: string;
	storyName: string;
	actSummary: string;
	narrativeBody: string;
	sceneNumber: number;
	sceneTitle: string;
	interviewMessages: WorldBuilderMessage[];
}

function buildContext(
	actSummary: string,
	sceneNumber: number,
	sceneTitle: string,
	narrativeBody: string,
	interviewMessages: WorldBuilderMessage[]
): string {
	const parts: string[] = [];

	if (actSummary) {
		parts.push(`${sectionHeaders.actSummary}${actSummary}`);
	}

	parts.push(`${sectionHeaders.currentScene}${sceneWithNumberLabel(sceneNumber)}: ${sceneTitle}\n\n${narrativeBody}`);

	if (interviewMessages.length > 0) {
		const transcript = interviewMessages
			.filter((m) => m.role === 'user' || m.role === 'assistant')
			.map((m) => `**${m.role === 'user' ? playerLabel() : interviewerLabel()}**: ${m.content}`)
			.join('\n\n');
		if (transcript) {
			parts.push(`${sectionHeaders.interviewTranscript}${transcript}`);
		}
	}

	return parts.join('\n\n');
}

export async function generateTurnOfEvents(params: GenerateTurnOfEventsParams): Promise<string> {
	const { storyId, storyName, actSummary, narrativeBody, sceneNumber, sceneTitle, interviewMessages } = params;
	const config = getMainProviderConfig();
	if (!config?.apiKey) {
		throw new Error(ERR_NO_MAIN_PROVIDER);
	}

	const [generalInstructions, systemPrompt, promptTemplate] = await Promise.all([
		generalInstructionsLoader.loadByStory(storyId, storyName),
		actPlotInterviewSystemPromptLoader.loadByStory(storyId, storyName),
		actPlotInterviewTurnOfEventsPromptLoader.loadByStory(storyId, storyName),
	]);

	const fullSystemPrompt = systemPrompt.replace('{{generalInstructions}}', generalInstructions);
	const context = buildContext(actSummary, sceneNumber, sceneTitle, narrativeBody, interviewMessages);
	const userMessage = promptTemplate.replace('{{context}}', context);

	const model = await createModel(config);

	await log.info(LOG_TAG, `Generating turn of events for Scene ${sceneNumber}: ${sceneTitle}`);

	const result = await generateText({
		model,
		system: fullSystemPrompt,
		messages: [{ role: 'user', content: userMessage }],
	});

	const text = result.text.trim();
	if (!text) {
		throw new Error(ERR_EMPTY_TURN_OF_EVENTS);
	}

	await log.info(LOG_TAG, `Turn of events complete. Tokens: ${result.usage.totalTokens}, Length: ${text.length} chars`);

	return text;
}
