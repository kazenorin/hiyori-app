import { z } from 'zod';
import { tool } from 'ai';
import { ls } from '$lib/localization';
import { getActiveLocale } from '$lib/fs/prompt-loader';
import { getAllCharacterNames } from '$lib/db/character-profiles';
import { WORLD_TEMPLATES } from '$lib/features/world-builder/template-registry';
import { getNameDataset } from '$lib/features/name-suggestion/dataset';
import { buildExistingNameSet, suggestNames } from '$lib/features/name-suggestion/engine';
import { CULTURES, DEFAULT_AVOIDANCE, DEFAULT_COUNT, GENDERS, MAX_AVOIDANCE, MAX_COUNT, TOOL_NAME_TYPES, toNameThemes } from '$lib/features/name-suggestion/types';
import { log as toolLog } from './utils';

const LOG_TAG = 'suggest-character-name';

/**
 * Analytic Mode of `suggest-character-name`. Filters a curated, bundled name
 * database (selected by the active locale) instead of calling an LLM, so it
 * works with no provider configured. Shares the tool identifier with the AI
 * variant; the active variant is chosen by the `characterNameSuggestionMode`
 * setting in `buildSuggestCharacterNameTools`.
 */
export function createSuggestCharacterNameAnalyticTool() {
	const themeIds = WORLD_TEMPLATES.map((t) => t.id) as [string, ...string[]];

	const inputSchema = z.object({
		genders: z.array(z.enum(GENDERS)).optional().describe(ls('tools.suggestCharacterName.analytic.parameters.genders')),
		themes: z.array(z.enum(themeIds)).optional().describe(ls('tools.suggestCharacterName.analytic.parameters.themes')),
		cultures: z.array(z.enum(CULTURES)).optional().describe(ls('tools.suggestCharacterName.analytic.parameters.cultures')),
		nameTypes: z.array(z.enum(TOOL_NAME_TYPES)).optional().describe(ls('tools.suggestCharacterName.analytic.parameters.nameTypes')),
		avoidanceLevel: z
			.number()
			.int()
			.min(0)
			.max(MAX_AVOIDANCE)
			.optional()
			.default(DEFAULT_AVOIDANCE)
			.describe(ls('tools.suggestCharacterName.analytic.parameters.avoidanceLevel')),
		count: z
			.number()
			.int()
			.min(1)
			.max(MAX_COUNT)
			.optional()
			.default(DEFAULT_COUNT)
			.describe(ls('tools.suggestCharacterName.analytic.parameters.count')),
	});

	return tool({
		description: ls('tools.suggestCharacterName.analytic.description'),
		inputSchema,
		execute: async (input): Promise<string> => {
			const { genders, themes, cultures, nameTypes, avoidanceLevel, count } = input;
			await toolLog(
				`${LOG_TAG} (analytic) triggered: genders=${genders?.join('|') ?? '-'}, themes=${themes?.join('|') ?? '-'}, cultures=${cultures?.join('|') ?? '-'}, nameTypes=${nameTypes?.join('|') ?? '-'}, avoidanceLevel=${avoidanceLevel}, count=${count}`
			);

			const locale = getActiveLocale();
			const dataset = await getNameDataset(locale);
			const existing = await getAllCharacterNames();
			// Story themes (world-template ids) map onto the consolidated name-theme
			// vocabulary; unmapped ids drop out, and an empty result lifts the filter.
			const nameThemes = themes ? toNameThemes(themes) : undefined;
			const results = suggestNames(
				dataset,
				{ genders, themes: nameThemes?.length ? nameThemes : undefined, cultures, nameTypes, avoidanceLevel, count },
				buildExistingNameSet(existing),
				locale
			);

			if (results.length === 0) {
				await toolLog(`${LOG_TAG} (analytic): no matching unused names`);
				return ls('tools.suggestCharacterName.analytic.messages.empty');
			}

			const tagsLabel = ls('tools.suggestCharacterName.analytic.tagsLabel');
			const lines = results.map((entry) =>
				entry.meaningTags.length > 0 ? `- **${entry.name}** — ${tagsLabel}: ${entry.meaningTags.join(', ')}` : `- **${entry.name}**`
			);
			const output = lines.join('\n');
			await toolLog(`${LOG_TAG} (analytic):\n---\n${output}\n---`);
			return output;
		},
	});
}
