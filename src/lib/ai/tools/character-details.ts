import { ls } from '$lib/localization';
import { tool } from 'ai';
import { z } from 'zod';
import { type ToolSet } from 'ai';
import type { ToolContext } from './tools';
import { log } from './utils';
import { getLatestProfileByAlias } from '$lib/db/character-profiles';
import { traceActLineChain } from '$lib/db/acts';
import { formatCharacterProfileAsMessage } from '$lib/definitions/pipeline-sections';

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

			const body = formatCharacterProfileAsMessage(profile, includeSceneDetails);
			await log(`character-details returned ${profile.preferredName} (${body.length} chars)`);
			return body;
		},
	});
}

export function buildCharacterDetailsTools(ctx: ToolContext): ToolSet {
	return {
		'character-details': createCharacterDetailsTool(ctx),
	};
}
