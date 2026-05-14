import {ls} from "$lib/localization";
import {
	worldContentHeader,
	actPlotHeader,
	actSummaryHeader,
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
	sectionFormat,
} from './common-headers';

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
