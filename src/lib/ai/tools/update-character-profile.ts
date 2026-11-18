import { ls } from '#lib/localization/index.ts';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { ToolContext } from './tools';
import { log } from './utils';
import type { ProfileCompressionState, ProfileUpdateInput } from '#lib/ai/pipeline/types.ts';
import { isAbortLikeError } from '#lib/utils/async.ts';
import {
	getLatestProfileByAlias,
	insertCharacterProfile,
	toCanonicalName,
	ensurePreferredInAliases,
	normalizeTraits,
	type CharacterImportance,
} from '#lib/db/character-profiles.ts';
import { serializeCharacterSceneDetails } from '#lib/ai/act-summary-parser.ts';

function throwIfAborted(abortSignal: AbortSignal | undefined): void {
	if (abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

export async function applyCharacterProfileUpdate(
	actLineId: string,
	compression: ProfileCompressionState,
	input: ProfileUpdateInput,
	abortSignal: AbortSignal | undefined
): Promise<string> {
	throwIfAborted(abortSignal);
	compression.attemptCount += 1;
	await log(`update-character-profile triggered for actLineId=${actLineId}, name=${input.name}`);
	let result: string;
	let success = false;
	if (!input.name.trim()) {
		result = ls('tools.updateCharacterProfile.messages.emptyName');
		await log(`update-character-profile failed for ${input.name}: name must not be empty`);
	} else {
		try {
			const existing = await getLatestProfileByAlias(actLineId, input.name);
			throwIfAborted(abortSignal);
			const canonicalName = existing?.canonicalName ?? toCanonicalName(input.name);
			const preferredName = (input.preferredName ?? existing?.preferredName ?? input.name).replace(/^\[(.+)\]$/, '$1').trim();
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
				sceneDetails: summary ? serializeCharacterSceneDetails(summary, [preferredName, canonicalName, ...aliases]) : '',
				importance: (input.importance ?? existing?.importance ?? 4) as CharacterImportance,
			});
			compression.successCount += 1;
			result = ls('tools.updateCharacterProfile.messages.updated', { name: canonicalName, sceneNumber: compression.completedScenes });
			success = true;
			await log(`update-character-profile updated profile for ${canonicalName} at scene ${compression.completedScenes}`);
		} catch (err) {
			if (abortSignal?.aborted || isAbortLikeError(err)) throw err;
			const reason = err instanceof Error ? err.message : String(err);
			result = ls('tools.updateCharacterProfile.messages.failed', { name: input.name, reason });
			await log(`update-character-profile failed for ${input.name}: ${reason}`);
		}
	}
	try {
		compression.onAttempt?.({ input, result, success });
	} catch {
		// The observer is UI-only; it must never fail a profile update.
	}
	return result;
}

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
			execute: (input, options) => applyCharacterProfileUpdate(ctx.actLine.id, compression, input, options.abortSignal),
		}),
	};
}
