import { ls } from '#lib/localization/index.ts';
import type { ProfileUpdateAttempt } from './types';

const TEXT_FIELDS = ['logline', 'state', 'goal', 'relationships', 'voice'] as const;

/** Deterministic per-attempt markdown block: supplied fields only, then the tool result. */
export function formatProfileUpdateAttempt({ input, result }: ProfileUpdateAttempt): string {
	const lines: string[] = [`### ${input.name}`];
	if (input.preferredName !== undefined) lines.push(`- preferredName: ${input.preferredName}`);
	if (input.aliases !== undefined && input.aliases.length > 0) lines.push(`- aliases: ${input.aliases.join(', ')}`);
	for (const field of TEXT_FIELDS) {
		const value = input[field];
		if (value === undefined) continue;
		lines.push(`- ${field}: ${value === null ? ls('tools.updateCharacterProfile.log.cleared') : value}`);
	}
	if (input.traits !== undefined) lines.push(`- traits: ${input.traits.join(', ')}`);
	if (input.importance !== undefined) lines.push(`- importance: ${input.importance}`);
	lines.push(result);
	return lines.join('\n');
}

export function emptyCompressionLog(): string {
	return ls('tools.updateCharacterProfile.log.noChanges');
}
