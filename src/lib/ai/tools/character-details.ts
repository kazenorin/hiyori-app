import { ls } from '$lib/localization';
import { tool } from 'ai';
import { z } from 'zod';
import { type ToolSet } from 'ai';
import type { ToolContext } from './tools';
import { log } from './utils';
import { getLatestProfileByAlias, type CharacterImportance } from '$lib/db/character-profiles';
import { traceActLineChain } from '$lib/db/acts';
import { importanceLevelLabel } from '$lib/definitions/pipeline-prompts';
import { formatProfileResponseBody } from '$lib/definitions/pipeline-sections';

export function createCharacterDetailsTool(ctx: ToolContext) {
	const { actLine, act } = ctx;
	const currentActNumber = act.actNumber;

	const inputSchema = z.object({
		name: z.string().min(1).describe(ls('tools.characterDetails.parameters.name')),
		includeSceneDetails: z.boolean().optional().default(true).describe(ls('tools.characterDetails.parameters.includeSceneDetails')),
		actNumber: z.number().int().min(1).optional().describe(ls('tools.characterDetails.parameters.actNumber')),
	});

	return tool({
		description: ls('tools.characterDetails.description', { currentActNumber }),
		inputSchema,
		execute: async (input): Promise<string> => {
			const { name, includeSceneDetails = true, actNumber } = input;
			await log(`character-details triggered for actLineId=${actLine.id}, name=${name}, actNumber=${actNumber ?? 'current'}`);

			let targetActLineId = actLine.id;
			let distantAct = false;

			if (actNumber != null) {
				if (actNumber > currentActNumber) {
					return ls('tools.characterDetails.messages.futureAct');
				}

				const chain = await traceActLineChain(actLine.id);
				const entry = chain.find((e) => e.actNumber === actNumber);

				if (!entry) {
					return ls('tools.characterDetails.messages.actNotInLineage', { actNumber });
				}

				targetActLineId = entry.actLineId;
				distantAct = true;
			}

			const profile = await getLatestProfileByAlias(targetActLineId, name);
			if (!profile) {
				return distantAct
					? ls('tools.characterDetails.messages.notFoundInAct', { actNumber: actNumber! })
					: ls('tools.characterDetails.messages.notFound');
			}

			const parts: string[] = [
				`### ${profile.preferredName}`,
				`- ${ls('tools.characterDetails.output.importance', {
					importance: importanceLevelLabel(profile.importance as CharacterImportance),
				})}`,
			];
			if (profile.aliases.length > 0) {
				parts.push(`- ${ls('tools.characterDetails.output.aliases', { aliases: profile.aliases.join(', ') })}`);
			}
			if (profile.sceneNumber != null) {
				parts.push(`- ${ls('tools.characterDetails.output.lastUpdated', { sceneNumber: profile.sceneNumber })}`);
			}
			const body = formatProfileResponseBody(profile);
			parts.push('');
			parts.push(body);

			if (includeSceneDetails && profile.sceneDetails.trim()) {
				parts.push('');
				parts.push(`**${ls('tools.characterDetails.output.sceneDetails')}**:`);
				parts.push(profile.sceneDetails.trim());
			}

			await log(`character-details returned ${profile.preferredName} (${body.length} chars)`);
			return parts.join('\n');
		},
	});
}

export function buildCharacterDetailsTools(ctx: ToolContext): ToolSet {
	return {
		'character-details': createCharacterDetailsTool(ctx),
	};
}
