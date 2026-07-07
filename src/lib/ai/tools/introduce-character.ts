import { ls } from '$lib/localization';
import { tool } from 'ai';
import { z } from 'zod';
import { type ToolSet } from 'ai';
import type { ToolContext } from './tools';
import { log } from './utils';
import {
	insertCharacterProfile,
	areAnyCharacterNamesKnown,
	resolveCanonicalName,
	ensurePreferredInAliases,
	type CharacterImportance,
	toCanonicalName,
} from '$lib/db/character-profiles';

export function createIntroduceCharacterTool(ctx: ToolContext) {
	const { actLine } = ctx;

	const inputSchema = z.object({
		preferredName: z.string().min(1).describe(ls('tools.introduceCharacter.parameters.preferredName')),
		aliases: z.array(z.string()).optional().default([]).describe(ls('tools.introduceCharacter.parameters.aliases')),
		profile: z.string().min(1).describe(ls('tools.introduceCharacter.parameters.profile')),
		importance: z
			.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
			.describe(ls('tools.introduceCharacter.parameters.importance')),
		oneLineDescription: z.string().optional().describe(ls('tools.introduceCharacter.parameters.oneLineDescription')),
	});

	return tool({
		description: ls('tools.introduceCharacter.description'),
		inputSchema,
		execute: async (input): Promise<string> => {
			const { preferredName, aliases = [], profile, importance, oneLineDescription } = input;
			await log(`introduce-character triggered for actLineId=${actLine.id}, name=${preferredName}`);

			const allNames = [preferredName, ...aliases];
			if (await areAnyCharacterNamesKnown(actLine.id, allNames)) {
				return ls('tools.introduceCharacter.messages.exists');
			}

			const fullProfile = oneLineDescription ? `${oneLineDescription}\n\n${profile}` : profile;
			const canonicalName = toCanonicalName(preferredName);
			const allAliases = ensurePreferredInAliases(preferredName, aliases);

			await insertCharacterProfile({
				id: crypto.randomUUID(),
				actLineId: actLine.id,
				sceneNumber: null,
				canonicalName,
				preferredName,
				aliases: allAliases,
				profile: fullProfile,
				sceneDetails: '',
				importance: importance as CharacterImportance,
			});

			await log(`introduce-character created profile for ${preferredName} (importance=${importance})`);
			return `Character profile created for ${preferredName}.`;
		},
	});
}

export function buildIntroduceCharacterTools(ctx: ToolContext): ToolSet {
	return {
		'introduce-character': createIntroduceCharacterTool(ctx),
	};
}
