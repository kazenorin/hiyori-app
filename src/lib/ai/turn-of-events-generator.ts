import { generateText } from 'ai';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { createModel } from './provider';
import { loadActPlotInterviewSystemPrompt, loadGeneralInstructions, loadActPlotInterviewTurnOfEventsPrompt } from '$lib/fs/prompts';
import { log } from '$lib/logging/logger';
import type { WorldBuilderMessage } from './world-builder.svelte';
import { TOE_SECTION, playerLabel, interviewerLabel } from '$lib/definitions/llm-context-labels';
import { ERR_NO_MAIN_PROVIDER, ERR_EMPTY_TURN_OF_EVENTS } from '$lib/definitions/error-messages';

const LOG_TAG = 'turn-of-events-generator';

export interface GenerateTurnOfEventsParams {
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
		parts.push(`${TOE_SECTION.ACT_SUMMARY}\n\n${actSummary}`);
	}

	parts.push(`${TOE_SECTION.CURRENT_SCENE}\n\nScene ${sceneNumber}: ${sceneTitle}\n\n${narrativeBody}`);

	if (interviewMessages.length > 0) {
		const transcript = interviewMessages
			.filter((m) => m.role === 'user' || m.role === 'assistant')
			.map((m) => `**${m.role === 'user' ? playerLabel() : interviewerLabel()}**: ${m.content}`)
			.join('\n\n');
		if (transcript) {
			parts.push(`${TOE_SECTION.INTERVIEW_TRANSCRIPT}\n\n${transcript}`);
		}
	}

	return parts.join('\n\n');
}

export async function generateTurnOfEvents(params: GenerateTurnOfEventsParams): Promise<string> {
	const { actSummary, narrativeBody, sceneNumber, sceneTitle, interviewMessages } = params;
	const config = getMainProviderConfig();
	if (!config?.apiKey) {
		throw new Error(ERR_NO_MAIN_PROVIDER);
	}

	const [generalInstructions, systemPrompt, promptTemplate] = await Promise.all([
		loadGeneralInstructions(),
		loadActPlotInterviewSystemPrompt(),
		loadActPlotInterviewTurnOfEventsPrompt(),
	]);

	const fullSystemPrompt = systemPrompt.replace('{generalInstructions}', generalInstructions);
	const context = buildContext(actSummary, sceneNumber, sceneTitle, narrativeBody, interviewMessages);
	const userMessage = promptTemplate.replace('{context}', context);

	const model = createModel(config);

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
