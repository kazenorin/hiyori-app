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

export type CompressionStage = 'generation' | 'repair' | 'tools';
export type CompressionStageLabel = CompressionStage | 'toolsDirect' | 'applied' | 'failed' | 'cancelled' | 'retry';

/** Accumulates run-log sections; rendering is pure and callers own streaming/emission. */
export function createCompressionLog(
	directTools: boolean,
	label: (key: CompressionStageLabel) => string
): {
	beginStage: (stage: CompressionStage) => void;
	addAttempt: (attempt: ProfileUpdateAttempt) => void;
	addFallbackReason: (reason: string) => void;
	addRetry: () => void;
	addFailure: (cancelled: boolean, reason: string) => void;
	streamContent: () => string;
	committedContent: (withNoChangesMarker: boolean) => string;
} {
	const logBlocks: string[] = [];
	const appliedAttempts: string[] = [];
	const failedAttempts: string[] = [];

	const render = (): string => {
		const sections = [...logBlocks];
		if (appliedAttempts.length > 0) sections.push(`## ${label('applied')}\n\n${appliedAttempts.join('\n\n')}`);
		if (failedAttempts.length > 0) sections.push(`## ${label('failed')}\n\n${failedAttempts.join('\n\n')}`);
		return sections.join('\n\n');
	};

	return {
		beginStage: (stage) => {
			logBlocks.push(`## ${label(stage === 'tools' && directTools ? 'toolsDirect' : stage)}`);
		},
		addAttempt: (attempt) => {
			(attempt.success ? appliedAttempts : failedAttempts).push(formatProfileUpdateAttempt(attempt));
		},
		addFallbackReason: (reason) => {
			logBlocks.push(`- ${label('failed')}: ${reason}`);
		},
		addRetry: () => {
			logBlocks.push(`## ${label('retry')}`);
		},
		addFailure: (cancelled, reason) => {
			logBlocks.push(`## ${label(cancelled ? 'cancelled' : 'failed')}${cancelled ? '' : `\n\n${reason}`}`);
		},
		streamContent: render,
		committedContent: (withNoChangesMarker) => {
			const logContent = render();
			if (withNoChangesMarker && appliedAttempts.length === 0 && failedAttempts.length === 0) {
				return logContent ? `${logContent}\n\n${emptyCompressionLog()}` : emptyCompressionLog();
			}
			return logContent;
		},
	};
}
