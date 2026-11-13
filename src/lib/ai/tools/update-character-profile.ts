import { ls } from '#lib/localization/index.ts';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { ToolContext } from './tools';
import type { ProfileCompressionState } from '#lib/ai/pipeline/types.ts';
import {
	getLatestProfileByAlias,
	insertCharacterProfile,
	toCanonicalName,
	ensurePreferredInAliases,
	normalizeTraits,
	type CharacterImportance,
} from '#lib/db/character-profiles.ts';
import { serializeCharacterSceneDetails } from '#lib/ai/act-summary-parser.ts';

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
			execute: async (input): Promise<string> => {
				compression.attemptCount += 1;
				let result: string;
				let success = false;
				if (!input.name.trim()) {
					result = 'Profile update failed: name must not be empty';
				} else {
					try {
						const actLineId = ctx.actLine.id;
						const existing = await getLatestProfileByAlias(actLineId, input.name);
						const canonicalName = existing?.canonicalName ?? toCanonicalName(input.name);
						const preferredName = input.preferredName ?? existing?.preferredName ?? input.name;
						const aliases = ensurePreferredInAliases(preferredName, [...new Set([...(existing?.aliases ?? []), ...(input.aliases ?? [])])]);
						const summary = compression.newActSummary;
						await insertCharacterProfile({
							id: crypto.randomUUID(),
							actLineId,
							sceneNumber: compression.completedScenes,
							canonicalName,
							preferredName,
							aliases,
							// logline clears to '' — the column is NOT NULL (design §5.3 deviation)
							logline: input.logline === undefined ? (existing?.logline ?? '') : (input.logline ?? ''),
							state: input.state === undefined ? (existing?.state ?? null) : input.state,
							goal: input.goal === undefined ? (existing?.goal ?? null) : input.goal,
							relationships: input.relationships === undefined ? (existing?.relationships ?? null) : input.relationships,
							voice: input.voice === undefined ? (existing?.voice ?? null) : input.voice,
							traits: input.traits === undefined ? (existing?.traits ?? []) : normalizeTraits(input.traits),
							sceneDetails: summary ? serializeCharacterSceneDetails(summary, preferredName) : '',
							importance: (input.importance ?? existing?.importance ?? 4) as CharacterImportance,
						});
						compression.successCount += 1;
						result = `Profile updated for ${canonicalName} at scene ${compression.completedScenes}.`;
						success = true;
					} catch (err) {
						result = `Profile update failed for ${input.name}: ${err instanceof Error ? err.message : String(err)}`;
					}
				}
				try {
					compression.onAttempt?.({ input, result, success });
				} catch {
					// The observer is UI-only; it must never fail a profile update.
				}
				return result;
			},
		}),
	};
}
