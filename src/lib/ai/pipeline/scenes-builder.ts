import type { UIMessage } from '../chat/types';
import {
	sectionFormat,
	sceneTitleHeader,
	backgroundHeader,
	narrativeBodyHeader,
	turnOfEventsHeader,
	playerResponseHeader,
	upcomingScenePlotHeader,
	scenesHeader,
} from '$lib/definitions/common-headers';
import { sceneWithNumberLabel } from '$lib/definitions/common-labels';
import { hasContent } from './message-builder';

function fieldSection(header: string, value: string | null | undefined): string[] {
	return hasContent(value) ? [sectionFormat(header, 3) + value!.trim()] : [];
}

/**
 * Reconstruct raw scene history from `fromScene` up to the scene being generated.
 * Each completed assistant scene becomes one `## Scene N` block; the player response
 * that followed it is folded in as `### Player Response`. The output is append-only
 * across turns (a new scene appends a new block; earlier blocks are byte-identical),
 * which is what keeps the shared prefix cacheable turn-to-turn.
 */
export function buildScenesSections(messages: UIMessage[], fromScene: number, upcomingScenePlot?: string): string[] {
	const sections: string[] = [];

	for (let i = 0; i < messages.length; i++) {
		const m = messages[i];
		if (m.role !== 'assistant' || m.sceneNumber < fromScene || !hasContent(m.variables?.narrativeBody)) continue;

		sections.push(sectionFormat(sceneWithNumberLabel(m.sceneNumber), 2));
		sections.push(...fieldSection(sceneTitleHeader(), m.variables!.sceneTitle));
		sections.push(...fieldSection(backgroundHeader(), m.variables!.background));
		sections.push(...fieldSection(narrativeBodyHeader(), m.variables!.narrativeBody));
		sections.push(...fieldSection(turnOfEventsHeader(), m.variables!.turnOfEvents));

		const next = messages[i + 1];
		if (next?.role === 'user' && hasContent(next.content)) {
			sections.push(...fieldSection(playerResponseHeader(), next.content));
		}
	}

	if (hasContent(upcomingScenePlot)) {
		sections.push(sectionFormat(upcomingScenePlotHeader(), 2) + upcomingScenePlot!.trim());
	}

	return sections;
}

/** Assemble the Tier-2 Scenes message (`# Scenes` + the raw scene blocks). */
export function buildScenesMessage(messages: UIMessage[], fromScene: number, upcomingScenePlot?: string): string {
	return (sectionFormat(scenesHeader(), 1) + buildScenesSections(messages, fromScene, upcomingScenePlot).join('\n')).trimEnd();
}
