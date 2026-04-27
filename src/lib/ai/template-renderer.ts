import { type NarrativeVariables, NARRATIVE_VARIABLE_FIELDS, NUMBER_FIELDS } from './parser-chain';

/**
 * Check if a message has structural fields that indicate template-based rendering.
 */
export function hasStructuralFields(vars?: NarrativeVariables | null): boolean {
	if (!vars) return false;
	return !!(vars.storyTitle || vars.actNumber || vars.sessionNumber || vars.sceneNumber || vars.sceneTitle);
}

/**
 * Render a view template by substituting {placeholder} tokens with variable values.
 */
export function renderTemplate(template: string, vars: NarrativeVariables): string {
	let result = template;
	for (const key of NARRATIVE_VARIABLE_FIELDS) {
		const value = vars[key];
		if (typeof value === 'string') {
			result = result.replaceAll(`{${key}}`, value);
		} else if (typeof value === 'number') {
			result = result.replaceAll(`{${key}}`, String(value));
		} else if (NUMBER_FIELDS.has(key)) {
			result = result.replaceAll(`{${key}}`, '1');
		} else {
			result = result.replaceAll(`{${key}}`, '');
		}
	}
	// Decisions placeholder: format as numbered list from gameData
	const decisions = vars.gameData?.decisions;
	if (decisions && decisions.length > 0) {
		const decisionsText = decisions.map((d, i) => `${i + 1}. ${d}`).join('\n');
		result = result.replaceAll('{decisions}', decisionsText);
	} else {
		result = result.replaceAll('{decisions}', '');
	}
	return result;
}
