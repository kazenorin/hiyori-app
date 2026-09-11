import { generateText } from 'ai';
import { z } from 'zod';
import { type ToolSet, tool } from 'ai';
import { ls } from '$lib/localization';
import { createModel } from '$lib/ai/provider/provider';
import { getCharacterNameSuggestionMode, getPlotPlannerProviderConfig, type PlotPlannerProviderConfig } from '$lib/stores/settings.svelte';
import { suggestCharacterNamePromptLoader } from '$lib/fs/prompts';
import { createSuggestCharacterNameAnalyticTool } from './suggest-character-name-analytic';
import { getAllCharacterNames } from '$lib/db/character-profiles';
import { isAuthError, withRetry } from '$lib/utils/async';
import { log as toolLog } from './utils';
import { log } from '$lib/logging/logger';
import type { Story } from '$lib/db/stories';

const LOG_TAG = 'suggest-character-name';
const RETRY_COUNT = 2;
const BACKOFF_MS = 2000;

export function createSuggestCharacterNameTool(ctx: { story: Story }) {
	const { story } = ctx;

	const inputSchema = z.object({
		gender: z.enum(['masculine', 'feminine', 'neutral']).optional().describe(ls('tools.suggestCharacterName.parameters.gender')),
		culture: z.string().optional().describe(ls('tools.suggestCharacterName.parameters.culture')),
		storyTheme: z.string().optional().describe(ls('tools.suggestCharacterName.parameters.storyTheme')),
		characterTheme: z.string().min(1).describe(ls('tools.suggestCharacterName.parameters.characterTheme')),
		includeAliases: z.boolean().optional().default(false).describe(ls('tools.suggestCharacterName.parameters.includeAliases')),
	});

	return tool({
		description: ls('tools.suggestCharacterName.description'),
		inputSchema,
		execute: async (input): Promise<string> => {
			const { gender, culture, storyTheme, characterTheme, includeAliases = false } = input;
			await toolLog(
				`${LOG_TAG} triggered: gender=${gender ?? '-'}, culture=${culture ?? '-'}, storyTheme=${storyTheme ?? '-'}, characterTheme=${characterTheme ?? '-'}, includeAliases=${includeAliases}`
			);

			const config = getPlotPlannerProviderConfig();
			if (!config) {
				await toolLog(`${LOG_TAG} unavailable — no plot planner provider configured`);
				return ls('tools.suggestCharacterName.messages.unavailable');
			}

			// Load the prompt template (story override → base config → bundled default).
			const template = await suggestCharacterNamePromptLoader.loadByStory(story.id, story.name);

			// Fetch existing character names across the entire app database.
			const known = await getAllCharacterNames();
			const constraintsPartial = buildConstraintsPartial(known);

			// Build each optional/conditional partial. Absent parameters yield empty strings.
			const genderPartial = gender ? ls('tools.suggestCharacterName.partials.gender', { gender }) : '';
			const culturePartial = culture ? ls('tools.suggestCharacterName.partials.culture', { culture }) : '';
			const storyThemePartial = storyTheme ? ls('tools.suggestCharacterName.partials.storyTheme', { storyTheme }) : '';
			const characterThemePartial = ls('tools.suggestCharacterName.partials.characterTheme', { characterTheme });
			const aliasesPartial = includeAliases ? ls('tools.suggestCharacterName.partials.aliases') : '';
			const aliasesInstructionPartial = includeAliases ? ls('tools.suggestCharacterName.partials.aliasesInstruction') : '';

			const prompt = template
				.replaceAll('{{genderPartial}}', genderPartial)
				.replaceAll('{{culturePartial}}', culturePartial)
				.replaceAll('{{storyThemePartial}}', storyThemePartial)
				.replaceAll('{{characterThemePartial}}', characterThemePartial)
				.replaceAll('{{aliasesPartial}}', aliasesPartial)
				.replaceAll('{{aliasesInstructionPartial}}', aliasesInstructionPartial)
				.replaceAll('{{constraintsPartial}}', constraintsPartial);

			const generatedSuggestion = await generateWithRetry(prompt, config);
			await toolLog(`${LOG_TAG}:\n---\n${generatedSuggestion}\n---`);
			return generatedSuggestion;
		},
	});
}

async function generateWithRetry(prompt: string, config: PlotPlannerProviderConfig): Promise<string> {
	const model = await createModel(config);
	const systemPrompt = ls('tools.suggestCharacterName.systemPrompt');

	return withRetry(() => generateText({ model, instructions: systemPrompt, prompt, ...(config.callSettings ?? {}) }).then((r) => r.text), {
		maxAttempts: RETRY_COUNT + 1,
		backoffMs: BACKOFF_MS,
		shouldRetry: (err) => !isAuthError(err),
		onRetry: (attempt) => log.warn(LOG_TAG, `Attempt ${attempt} failed, retrying...`),
	});
}

/**
 * Render the constraints partial. Substitutes `{{knownCharacters}}` with a
 * bulleted list of existing preferred names and their aliases. When no known
 * characters exist, returns an empty string so the entire section is omitted.
 */
function buildConstraintsPartial(known: { preferredName: string; aliases: string[] }[]): string {
	if (known.length === 0) return '';
	const template = ls('tools.suggestCharacterName.constraints');
	const lines = known.map((entry) => {
		const extras = entry.aliases.filter((a) => a !== entry.preferredName);
		return extras.length > 0
			? `- ${entry.preferredName}, ${ls('tools.suggestCharacterName.aka')}: ${extras.join(', ')}`
			: `- ${entry.preferredName}`;
	});
	return template.replaceAll('{{knownCharacters}}', lines.join('\n'));
}

/**
 * Build the `suggest-character-name` tool for the configured engine mode. Both
 * modes share this single tool identifier; the active variant is swapped here
 * rather than via a dynamic schema (unlike `advance-phase`).
 */
export function buildSuggestCharacterNameTools(ctx: { story: Story }): ToolSet {
	const mode = getCharacterNameSuggestionMode();
	return {
		'suggest-character-name': mode === 'analytic' ? createSuggestCharacterNameAnalyticTool() : createSuggestCharacterNameTool(ctx),
	};
}
