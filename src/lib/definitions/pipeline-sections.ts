import { ls } from '$lib/localization';
import type { ActPhase } from '$lib/ai/narrative-types';
import {
	worldContentHeader,
	actPlotHeader,
	actSummaryHeader,
	actPhaseHeader,
	interviewTranscriptHeader,
	playerResponseHeader,
	scenePlotHeader,
	writerOutputTemplateHeader,
	writerOutputHeader,
	reviewerOutputHeader,
	reviewerFeedbackHeader,
	editorOutputHeader,
	gameMasterOutputHeader,
	previousActSummaryHeader,
	previousNarrativeBodyHeader,
	turnOfEventsHeader,
	templateHeader,
	directorNotesHeader,
	storySoFarHeader,
	characterProfilesHeader,
	sectionFormat,
} from './common-headers';
import {
	getLocalizedActPhase,
	importanceLevelLabel,
	lastSeenLabel,
	noDescriptionLabel,
	sceneDetailsLabel,
	importanceValueLabel,
	aliasesValueLabel,
	lastUpdatedLabel,
	stateLabel,
	loglineLabel,
	goalLabel,
	relationshipsLabel,
	voiceLabel,
} from './pipeline-prompts';
import { actWithNumberLabel, aliasesLabel } from '$lib/definitions/common-labels';
import type { CharacterProfileEntity } from '$lib/db/character-profiles';

export const interviewTranscriptDescription = () => ls('common.descriptions.interviewTranscript');

/** Markdown section headings used in LLM message construction. */
export const SECTION = {
	get WORLD_CONTENT() {
		return sectionFormat(worldContentHeader());
	},
	get ACT_PLOT() {
		return sectionFormat(actPlotHeader());
	},
	get ACT_SUMMARY() {
		return sectionFormat(actSummaryHeader());
	},
	get PLAYER_RESPONSE() {
		return sectionFormat(playerResponseHeader());
	},
	get SCENE_PLOT() {
		return sectionFormat(scenePlotHeader());
	},
	get WRITER_OUTPUT_TEMPLATE() {
		return sectionFormat(writerOutputTemplateHeader());
	},
	get WRITER_OUTPUT() {
		return sectionFormat(writerOutputHeader());
	},
	get REVIEWER_OUTPUT() {
		return sectionFormat(reviewerOutputHeader());
	},
	get EDITOR_OUTPUT() {
		return sectionFormat(editorOutputHeader());
	},
	get GAME_MASTER_OUTPUT() {
		return sectionFormat(gameMasterOutputHeader());
	},
	get TURN_OF_EVENTS() {
		return sectionFormat(turnOfEventsHeader());
	},
	get DIRECTOR_NOTES() {
		return sectionFormat(directorNotesHeader()) + ls('common.descriptions.directorNotes') + '\n\n';
	},
	get ACT_PHASE() {
		return sectionFormat(actPhaseHeader());
	},
	get STORY_SO_FAR() {
		return sectionFormat(storySoFarHeader());
	},
	get CHARACTER_PROFILES() {
		return sectionFormat(characterProfilesHeader()) + ls('common.descriptions.characterProfiles') + '\n\n';
	},
	get CHARACTER_PROFILES_INLINE() {
		return ls('common.descriptions.characterProfilesInline');
	},
	get CHARACTER_PROFILES_OTHER() {
		return ls('common.descriptions.characterProfilesOther');
	},
};

/** Section headings for act-plot generation phases (used by act-plot-generator). */
export const ACT_PLOT_SECTION = {
	get WORLD_CONTENT() {
		return sectionFormat(worldContentHeader());
	},
	get PREVIOUS_ACT_SUMMARY() {
		return sectionFormat(previousActSummaryHeader());
	},
	get TURN_OF_EVENTS() {
		return sectionFormat(turnOfEventsHeader());
	},
	get INTERVIEW_TRANSCRIPT() {
		return sectionFormat(interviewTranscriptHeader()) + interviewTranscriptDescription();
	},
	get WRITER_OUTPUT() {
		return sectionFormat(writerOutputHeader());
	},
	get REVIEWER_FEEDBACK() {
		return sectionFormat(reviewerFeedbackHeader());
	},
	get TEMPLATE() {
		return sectionFormat(templateHeader());
	},
	get CHARACTER_CARDS() {
		return sectionFormat(ls('pipeline.sections.actPlotCharacterCards'));
	},
	get ACT_CARDS() {
		return sectionFormat(ls('pipeline.sections.actPlotActCards'));
	},
	get CHARACTER_PROFILES() {
		return sectionFormat(ls('pipeline.sections.actPlotCharacterProfiles'));
	},
};

/** Format the previous narrative body as a user message section. Returns empty array if no body. */
export function formatPreviousNarrativeBody(previousNarrativeBody: string | null | undefined, completedScenes: number): string[] {
	if (!previousNarrativeBody || previousNarrativeBody.trim().length === 0) return [];
	return [sectionFormat(previousNarrativeBodyHeader(completedScenes)) + previousNarrativeBody];
}

/** Format the turn of events as a user message section. Returns empty array if no content. */
export function formatTurnOfEventsSection(turnOfEvents: string | null | undefined): string[] {
	if (!turnOfEvents || turnOfEvents.trim().length === 0) return [];
	return [SECTION.TURN_OF_EVENTS + turnOfEvents];
}

/** Format director's notes as a user message section. Returns empty array if no content. */
export function formatDirectorNotesSection(directorNotes: string | null | undefined): string[] {
	if (!directorNotes || directorNotes.trim().length === 0) return [];
	return [SECTION.DIRECTOR_NOTES + directorNotes];
}

/** Format act phase as a user message section. Returns empty array if no content. */
export function formatActPhaseSection(actPhase: ActPhase | null | undefined): string[] {
	if (!actPhase || actPhase.trim().length === 0) return [];
	return [SECTION.ACT_PHASE + getLocalizedActPhase(actPhase)];
}

export function formatStorySoFar(summaries: { actNumber: number; summary: string }[], currentActNumber: number): string[] {
	if (currentActNumber <= 1 || summaries.length === 0) return [];
	const items = summaries.map((s) => `**${actWithNumberLabel(s.actNumber)}:** ${s.summary}`).join('\n\n');
	return [SECTION.STORY_SO_FAR + items];
}

/**
 * Format character profiles into an inline section for the writer/reviewer/editor/GM prompts.
 * Characters with importance ≤ threshold are inlined in full, up to maxIncluded.
 * Remaining characters get a one-line reference so the LLM can retrieve them via `character-details`.
 *
 * Returns ["## Character Profiles\n<description>\n\n<inline>\n\n<one-line refs>"] or [].
 */
export function formatCharacterProfilesSection(profiles: CharacterProfileEntity[], threshold: number, maxIncluded: number): string[] {
	if (profiles.length === 0) return [];

	const sortedByImportance = [...profiles].sort((a, b) => {
		if (a.importance !== b.importance) return a.importance - b.importance;
		const aScene = a.sceneNumber ?? -1;
		const bScene = b.sceneNumber ?? -1;
		return bScene - aScene;
	});

	const inline = sortedByImportance.filter((p) => p.importance <= threshold).slice(0, maxIncluded);
	const inlineIds = new Set(inline.map((p) => p.id));
	const other = sortedByImportance.filter((p) => !inlineIds.has(p.id));

	const parts: string[] = [SECTION.CHARACTER_PROFILES];

	if (inline.length > 0) {
		parts.push(SECTION.CHARACTER_PROFILES_INLINE);
		parts.push('');

		for (const p of inline) {
			parts.push(`### ${p.preferredName}`);
			if (p.aliases.length > 0) {
				parts.push(`- ${aliasesLabel()}: [${p.aliases.join(', ')}]`);
			}
			parts.push(`- ${importanceLevelLabel(p.importance)}`);
			const body = formatProfileResponseBody(p);
			if (body) {
				parts.push('');
				parts.push(body);
			}
			if (p.sceneDetails.trim()) {
				parts.push('');
				parts.push(`**${sceneDetailsLabel()}**:`);
				parts.push(p.sceneDetails.trim());
			}
			parts.push('');
		}
	}

	if (other.length > 0) {
		parts.push(SECTION.CHARACTER_PROFILES_OTHER);
		parts.push('');
		for (const p of other) {
			const sceneInfo = p.sceneNumber != null ? ` (${lastSeenLabel(p.sceneNumber)})` : '';
			const oneLine = extractOneLineDescription(p);
			parts.push(`- ${p.preferredName} [${importanceLevelLabel(p.importance)}]${sceneInfo}: ${oneLine}`);
		}
	}

	return [parts.join('\n').trimEnd()];
}

/**
 * Render the structured fields (state, goal, relationships, voice) of a character profile
 * as labeled markdown lines. Null or blank fields are omitted. Returns empty string if all fields are blank.
 * Shared by the pipeline inline section and the `character-details` tool.
 */
export function formatProfileResponseBody(p: CharacterProfileEntity): string {
	const lines: string[] = [];
	const push = (label: string, body: string | null) => {
		const v = body?.trim();
		if (v) lines.push(`**${label}:** ${v}`);
	};
	push(loglineLabel(), p.logline);
	push(stateLabel(), p.state);
	push(goalLabel(), p.goal);
	push(relationshipsLabel(), p.relationships);
	push(voiceLabel(), p.voice);
	return lines.join('\n');
}

/**
 * Format a single character profile as a self-contained message block (header + metadata + body).
 * Shared by the `character-details` tool and the character-card generator.
 *
 * - `importance` is rendered as a localized "Importance: <level>" line.
 * - `aliases` and `lastUpdated` (scene number) are rendered only when present.
 * - The structured body (`formatProfileResponseBody`) is always appended.
 * - `sceneDetails` is appended only when `includeSceneDetails` is true and non-empty.
 */
export function formatCharacterProfileAsMessage(profile: CharacterProfileEntity, includeSceneDetails = true): string {
	const parts: string[] = [`### ${profile.preferredName}`, `- ${importanceValueLabel(importanceLevelLabel(profile.importance))}`];
	if (profile.aliases.length > 0) {
		parts.push(`- ${aliasesValueLabel(profile.aliases.join(', '))}`);
	}
	if (profile.sceneNumber != null) {
		parts.push(`- ${lastUpdatedLabel(profile.sceneNumber)}`);
	}
	const body = formatProfileResponseBody(profile);
	parts.push('');
	parts.push(body);

	if (includeSceneDetails && profile.sceneDetails.trim()) {
		parts.push('');
		parts.push(`**${sceneDetailsLabel()}**:`);
		parts.push(profile.sceneDetails.trim());
	}

	return parts.join('\n');
}

/**
 * Extract a single-line description from a character profile for compact one-line references.
 * Falls back to logline, then the first non-empty line of `state`, then `voice`, then a localized placeholder.
 */
export function extractOneLineDescription(profile: CharacterProfileEntity): string {
	const source = profile.logline?.trim() || profile.state?.trim() || profile.voice?.trim();
	if (!source) return noDescriptionLabel();
	const firstLine = source.split('\n').find((l) => l.trim().length > 0);
	if (firstLine) return firstLine.trim().replace(/^[-*]\s+/, '');
	return noDescriptionLabel();
}
