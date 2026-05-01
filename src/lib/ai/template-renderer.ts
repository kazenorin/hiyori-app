import {
	type NarrativeVariables,
	type GameDataFields,
	FIELD_DESCRIPTORS,
	NARRATIVE_VARIABLE_FIELDS,
} from './narrative-types';

const SERIALIZABLE_FIELDS = FIELD_DESCRIPTORS.filter((d) => d.includeInSerialization);

// Game data markdown headers
const GD_SECTION = '## Game Data';
const GD_ACTIVE_PLOT_THREADS = '### Active Plot Threads';
const GD_DECISION_CONTEXT = '### Decision Context';
const GD_DECISIONS = '### Decisions';

// --- Checks ---

/**
 * Check if variables have the identity fields (sceneTitle)
 * needed for template-based rendering.
 */
export function hasTemplateMetadata(vars?: NarrativeVariables | null): boolean {
	if (!vars) return false;
	return !!vars.sceneTitle;
}

/** Backward-compatible alias. */
export const hasStructuralFields = hasTemplateMetadata;

/**
 * Check if variables contain meaningful narrative content.
 */
export function hasNarrativeBody(vars: NarrativeVariables): boolean {
	return NARRATIVE_VARIABLE_FIELDS.some((key) => {
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
		} else {
			result = result.replaceAll(`{${key}}`, '');
		}
	}
	// Game data placeholders
	const gd = vars.gameData;
	if (gd) {
		// {activePlotThreads} from gameData
		if (gd.activePlotThreads.length > 0) {
			result = result.replaceAll('{activePlotThreads}', gd.activePlotThreads.map((t) => `- ${t}`).join('\n'));
		} else {
			result = result.replaceAll('{activePlotThreads}', '');
		}
		// {decisionContext} from gameData
		result = result.replaceAll('{decisionContext}', gd.decisionContext ?? '');
		// {decisions} from gameData
		if (gd.decisions.length > 0) {
			const decisionsText = gd.decisions.map((d, i) => `${i + 1}. ${d}`).join('\n');
			result = result.replaceAll('{decisions}', decisionsText);
		} else {
			result = result.replaceAll('{decisions}', '');
		}
	} else {
		result = result.replaceAll('{activePlotThreads}', '');
		result = result.replaceAll('{decisionContext}', '');
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
 * Fields are emitted in descriptor order.
 */
export function variablesToMarkdown(vars: NarrativeVariables): string {
	const lines: string[] = [];

	for (const desc of SERIALIZABLE_FIELDS) {
		const value = vars[desc.fieldName];
		if (value == null) continue;
		if (Array.isArray(value) && value.length === 0) continue;

		// Emit field header and value
		lines.push('## ' + desc.headerName);
		if (Array.isArray(value)) {
			for (const item of value) lines.push(`- ${item}`);
		} else {
			lines.push((value as string).trim());
		}
	}

	return lines.join('\n');
}

/** Serialize GameDataFields to structured markdown for LLM history. */
export function gameDataToMarkdown(gd: GameDataFields): string {
	const lines = [GD_SECTION, ''];

	// Active Plot Threads
	if (gd.activePlotThreads.length > 0) {
		lines.push(GD_ACTIVE_PLOT_THREADS, '');
		for (const thread of gd.activePlotThreads) {
			lines.push(`- ${thread}`);
		}
		lines.push('');
	}

	// Decision Context
	if (gd.decisionContext) {
		lines.push(GD_DECISION_CONTEXT, '', gd.decisionContext, '');
	}

	// Decisions
	lines.push(GD_DECISIONS, '');
	for (const decision of gd.decisions) {
		lines.push(`- ${decision}`);
	}

	return lines.join('\n');
}