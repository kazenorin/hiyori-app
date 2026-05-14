import { type NarrativeVariables, type GameDataFields, FIELD_DESCRIPTORS, NARRATIVE_VARIABLE_FIELDS } from './narrative-types';

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
 * Uses single-pass regex replacement to avoid order-dependent behavior and
 * second-order substitution. Extra replacements take precedence over narrative variables.
 */
export function renderTemplate(template: string, vars: NarrativeVariables, extraReplacements?: Record<string, string>): string {
	// Build merged replacement map (extra replacements override narrative variables on collision)
	const replacements: Record<string, string> = {};

	for (const key of NARRATIVE_VARIABLE_FIELDS) {
		const value = vars[key];
		if (Array.isArray(value)) {
			replacements[key] = value.map((item) => `- ${item}`).join('\n');
		} else if (typeof value === 'string') {
			replacements[key] = value.trim();
		} else {
			replacements[key] = '';
		}
	}

	// Game data placeholders (only decisions — activePlotThreads and decisionContext
	// are displayed in the control section, not in the message template)
	const gd = vars.gameData;
	replacements['decisions'] = gd?.decisions.length ? gd.decisions.map((d, i) => `${i + 1}. ${d}`).join('\n') : '';

	// Extra replacements override narrative variables (e.g., programmatic sceneNumber over LLM output)
	if (extraReplacements) {
		Object.assign(replacements, extraReplacements);
	}

	// Single-pass replacement — avoids second-order substitution and order-dependent behavior
	return template.replace(/\{(\w+)}/g, (_, key: string) => replacements[key] ?? `{${key}}`);
}

/**
 * Render template from variables, returning empty string if no template metadata present.
 */
export function renderFromVariables(
	vars: NarrativeVariables | null | undefined,
	template: string,
	extraReplacements?: Record<string, string>
): string {
	if (!vars || !hasTemplateMetadata(vars)) return '';
	return renderTemplate(template, vars, extraReplacements);
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
		lines.push('## ' + desc.headerName());
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
