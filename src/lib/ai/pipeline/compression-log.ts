import { ls } from '#lib/localization/index.ts';
import {
	stateLabel,
	loglineLabel,
	goalLabel,
	relationshipsLabel,
	voiceLabel,
	traitsLabel,
	importanceLabel,
} from '#lib/definitions/character-profile-labels.ts';
import { aliasesLabel } from '#lib/definitions/common-labels.ts';
import type { ProfileUpdateAttempt } from './types';

const TEXT_FIELDS = ['logline', 'state', 'goal', 'relationships', 'voice'] as const;

const FIELD_LABELS: Record<(typeof TEXT_FIELDS)[number], () => string> = {
	logline: loglineLabel,
	state: stateLabel,
	goal: goalLabel,
	relationships: relationshipsLabel,
	voice: voiceLabel,
};

/** Deterministic per-attempt markdown block: supplied fields only, then the tool result. */
export function formatProfileUpdateAttempt({ input, result }: ProfileUpdateAttempt): string {
	const lines: string[] = [`### ${input.name}`];
	if (input.preferredName !== undefined) lines.push(`- ${ls('pipeline.labels.preferredName')}: ${input.preferredName}`);
	if (input.aliases !== undefined && input.aliases.length > 0) lines.push(`- ${aliasesLabel()}: ${input.aliases.join(', ')}`);
	for (const field of TEXT_FIELDS) {
		const value = input[field];
		if (value === undefined) continue;
		lines.push(`- ${FIELD_LABELS[field]()}: ${value === null ? ls('tools.updateCharacterProfile.log.cleared') : value}`);
	}
	if (input.traits !== undefined) lines.push(`- ${traitsLabel()}: ${input.traits.join(', ')}`);
	if (input.importance !== undefined) lines.push(`- ${importanceLabel()}: ${input.importance}`);
	lines.push('', result);
	return lines.join('\n');
}

export function emptyCompressionLog(): string {
	return ls('tools.updateCharacterProfile.log.noChanges');
}
