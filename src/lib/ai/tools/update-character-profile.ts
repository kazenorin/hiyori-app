import { ls } from '#lib/localization/index.ts';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { ToolContext } from './tools';
import type { ProfileCompressionState } from '#lib/ai/pipeline/types.ts';

export function buildUpdateCharacterProfileTools(ctx: ToolContext, compression: ProfileCompressionState): ToolSet {
	const inputSchema = z.object({
		name: z.string().min(1).describe(ls('tools.updateCharacterProfile.parameters.name')),
		preferredName: z.string().min(1).optional().describe(ls('tools.updateCharacterProfile.parameters.preferredName')),
		aliases: z.array(z.string().min(1)).optional().describe(ls('tools.updateCharacterProfile.parameters.aliases')),
		logline: z.string().nullable().optional().describe(ls('tools.updateCharacterProfile.parameters.logline')),
		state: z.string().nullable().optional().describe(ls('tools.updateCharacterProfile.parameters.state')),
		goal: z.string().nullable().optional().describe(ls('tools.updateCharacterProfile.parameters.goal')),
		relationships: z.string().nullable().optional().describe(ls('tools.updateCharacterProfile.parameters.relationships')),
		voice: z.string().nullable().optional().describe(ls('tools.updateCharacterProfile.parameters.voice')),
		traits: z.array(z.string().min(1)).optional().describe(ls('tools.updateCharacterProfile.parameters.traits')),
		importance: z.number().int().min(1).max(4).optional().describe(ls('tools.updateCharacterProfile.parameters.importance')),
	});
	return {
		'update-character-profile': tool({
			description: ls('tools.updateCharacterProfile.description'),
			inputSchema,
			execute: async (): Promise<string> => {
				// Unreachable until the compressor allow-list flips (design step 2); guarded in every phase until then.
				throw new Error('update-character-profile is not enabled yet');
			},
		}),
	};
}
