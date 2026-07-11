import { ls } from '$lib/localization';
import { tool } from 'ai';
import { z } from 'zod';
import { type ToolSet } from 'ai';
import type { ToolContext } from './tools';
import { log } from './utils';
import {
	insertCharacterProfile,
	areAnyCharacterNamesKnown,
	ensurePreferredInAliases,
	type CharacterImportance,
	toCanonicalName,
} from '$lib/db/character-profiles';

export function createIntroduceCharacterTool(ctx: ToolContext) {
	const { actLine } = ctx;

	const inputSchema = z.object({
		preferredName: z.string().min(1).describe(ls('tools.introduceCharacter.parameters.preferredName')),
		aliases: z.array(z.string()).optional().default([]).describe(ls('tools.introduceCharacter.parameters.aliases')),
		oneLineDescription: z.string().min(1).describe(ls('tools.introduceCharacter.parameters.oneLineDescription')),
		goal: z.string().optional().describe(ls('tools.introduceCharacter.parameters.goal')),
		relationships: z.string().optional().describe(ls('tools.introduceCharacter.parameters.relationships')),
		voice: z.string().optional().describe(ls('tools.introduceCharacter.parameters.voice')),
		importance: z
			.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
			.describe(ls('tools.introduceCharacter.parameters.importance')),
	});

	return tool({
		description: ls('tools.introduceCharacter.description'),
		inputSchema,
		execute: async (input): Promise<string> => {
			const { preferredName, aliases = [], oneLineDescription, goal, relationships, voice, importance } = input;
			await log(`introduce-character triggered for actLineId=${actLine.id}, name=${preferredName}`);

			const allNames = [preferredName, ...aliases];
			if (await areAnyCharacterNamesKnown(actLine.id, allNames)) {
				return ls('tools.introduceCharacter.messages.exists');
			}

			const canonicalName = toCanonicalName(preferredName);
			const allAliases = ensurePreferredInAliases(preferredName, aliases);

			await insertCharacterProfile({
				id: crypto.randomUUID(),
				actLineId: actLine.id,
				sceneNumber: null,
				canonicalName,
				preferredName,
				aliases: allAliases,
				state: oneLineDescription,
				goal: goal ?? null,
				relationships: relationships ?? null,
				voice: voice ?? null,
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
