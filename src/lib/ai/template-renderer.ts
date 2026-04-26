import { type NarrativeSections, NARRATIVE_SECTION_FIELDS } from './parser-chain';
import type { GameData } from '$lib/db/messages';

/**
 * Check if a message has structural fields that indicate template-based rendering.
 */
export function hasStructuralFields(sections?: NarrativeSections | null): boolean {
	if (!sections) return false;
	return !!(sections.storyTitle || sections.actNumber || sections.sessionNumber || sections.sceneNumber || sections.sceneTitle);
}

/**
 * Render a view template by substituting {placeholder} tokens with section values.
 */
export function renderTemplate(template: string, sections: NarrativeSections, gameData?: GameData | null): string {
	let result = template;

	for (const key of NARRATIVE_SECTION_FIELDS) {
		const value = sections[key];
		result = result.replaceAll(`{${key}}`, value ?? '');
	}

	// Game data: format decisions as a numbered list
	if (gameData?.decisions?.length) {
		const decisionsText = gameData.decisions.map((d, i) => `${i + 1}. ${d}`).join('\n');
		result = result.replaceAll('{decisions}', decisionsText);
	} else {
		result = result.replaceAll('{decisions}', '');
	}

	return result;
}
