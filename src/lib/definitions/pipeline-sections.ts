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
	sectionFormat,
} from './common-headers';
import { getLocalizedActPhase } from './pipeline-prompts';

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
	const items = summaries.map((s) => `**${ls('pipeline.labels.actWithNumber', { actNumber: s.actNumber })}:** ${s.summary}`).join('\n\n');
	return [SECTION.STORY_SO_FAR + items];
}
