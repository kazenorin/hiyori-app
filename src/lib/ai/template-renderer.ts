import {
	type NarrativeVariables,
	type GameDataFields,
	FIELD_DESCRIPTORS,
	NARRATIVE_VARIABLE_FIELDS,
	NUMBER_FIELDS,
} from './narrative-types';

const SERIALIZABLE_FIELDS = FIELD_DESCRIPTORS.filter((d) => d.includeInSerialization);

// Game data markdown headers
const GD_SECTION = '## Game Data';
const GD_WORLD_STATE = '### World State';
const GD_DECISIONS = '### Decisions';
const GD_PLAYER_ALIASES = '### Player Aliases';
const GD_OTHER_CHAR_ALIASES = '### Other Character Aliases';

// --- Checks ---

/**
 * Check if variables have the identity fields (storyTitle, act/session/scene numbers, sceneTitle)
 * needed for template-based rendering.
 */
export function hasTemplateMetadata(vars?: NarrativeVariables | null): boolean {
	if (!vars) return false;
	return !!(vars.storyTitle || vars.actNumber || vars.sessionNumber || vars.sceneNumber || vars.sceneTitle);
}

/** Backward-compatible alias. */
export const hasStructuralFields = hasTemplateMetadata;

/**
 * Check if variables contain meaningful narrative content (any field except scratchpad).
 */
export function hasNarrativeBody(vars: NarrativeVariables): boolean {
	return NARRATIVE_VARIABLE_FIELDS.some((key) => {
		if (key === 'scratchpad') return false;
		const val = vars[key];
		if (Array.isArray(val)) return val.length > 0;
		return val != null;
	});
}

// --- Rendering ---

/**
 * Render a view template by substituting {placeholder} tokens with variable values.
 */
export function renderTemplate(template: string, vars: NarrativeVariables): string {
	let result = template;
	for (const key of NARRATIVE_VARIABLE_FIELDS) {
		const value = vars[key];
		if (Array.isArray(value)) {
			result = result.replaceAll(`{${key}}`, value.map((item) => `- ${item}`).join('\n'));
		} else if (typeof value === 'string') {
			result = result.replaceAll(`{${key}}`, value.trim());
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

/**
 * Render template from variables, returning empty string if no template metadata present.
 */
export function renderFromVariables(vars: NarrativeVariables | null | undefined, template: string): string {
	if (!vars || !hasTemplateMetadata(vars)) return '';
	return renderTemplate(template, vars);
}

// --- Serialization (for LLM history) ---

/**
 * Serialize NarrativeVariables back to structured markdown for LLM history.
 * Fields are emitted in descriptor order, with section headers added as needed.
 */
export function variablesToMarkdown(vars: NarrativeVariables): string {
	const lines: string[] = [];
	let currentPath: string[] = [];

	for (const desc of SERIALIZABLE_FIELDS) {
		const value = vars[desc.fieldName];
		if (value == null) continue;
		if (Array.isArray(value) && value.length === 0) continue;

		const targetPath = desc.parentSections;

		// Find divergence point between current and target section paths
		let divergeIdx = 0;
		while (divergeIdx < currentPath.length && divergeIdx < targetPath.length && currentPath[divergeIdx] === targetPath[divergeIdx]) {
			divergeIdx++;
		}

		// Emit new section headers from divergence point
		for (let i = divergeIdx; i < targetPath.length; i++) {
			lines.push('', '#'.repeat(2 + i) + ' ' + targetPath[i], '');
		}
		currentPath = [...targetPath];

		// Emit field header and value
		const fieldLevel = 2 + targetPath.length;
		lines.push('#'.repeat(fieldLevel) + ' ' + desc.headerName);
		if (Array.isArray(value)) {
			for (const item of value) lines.push(`- ${item}`);
		} else {
			lines.push(desc.isNumber ? String(value) : (value as string).trim());
		}
	}

	return lines.join('\n');
}

/** Serialize GameDataFields to structured markdown for LLM history. */
export function gameDataToMarkdown(gd: GameDataFields): string {
	const lines = [GD_SECTION, '', GD_WORLD_STATE, '', gd.worldState ?? '', '', GD_DECISIONS, ''];
	for (const decision of gd.decisions) {
		lines.push(`- ${decision}`);
	}
	if (gd.playerAliases.length > 0) {
		lines.push('', GD_PLAYER_ALIASES, '');
		for (const alias of gd.playerAliases) {
			lines.push(`- ${alias}`);
		}
	}
	const aliases = Object.entries(gd.otherCharacterAliases);
	if (aliases.length > 0) {
		lines.push('', GD_OTHER_CHAR_ALIASES, '');
		for (const [name, charAliases] of aliases) {
			if (charAliases.length > 0) {
				lines.push('', `#### ${name}`, '');
				for (const alias of charAliases) {
					lines.push(`- ${alias}`);
				}
			}
		}
	}
	return lines.join('\n');
}
