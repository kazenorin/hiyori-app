import { ls } from './locale-strings';

const sectionHeader = (text: string) => `\n## ${text}\n`;
const actPlotHeader = (text: string) => `## ${text}\n\n`;

/** Markdown section headings used in LLM message construction. */
export const SECTION = {
	get WORLD_CONTENT() {
		return sectionHeader(ls('sectionConstants.headers.worldContent'));
	},
	get ACT_PLOT() {
		return sectionHeader(ls('sectionConstants.headers.actPlot'));
	},
	get ACT_SUMMARY() {
		return sectionHeader(ls('sectionConstants.headers.actSummary'));
	},
	get PLAYER_RESPONSE() {
		return sectionHeader(ls('sectionConstants.headers.playerResponse'));
	},
	get SCENE_PLOT() {
		return sectionHeader(ls('sectionConstants.headers.scenePlot'));
	},
	get WRITER_OUTPUT_TEMPLATE() {
		return sectionHeader(ls('sectionConstants.headers.writerOutputTemplate'));
	},
	get WRITER_OUTPUT() {
		return sectionHeader(ls('sectionConstants.headers.writerOutput'));
	},
	get REVIEWER_OUTPUT() {
		return sectionHeader(ls('sectionConstants.headers.reviewerOutput'));
	},
	get EDITOR_OUTPUT() {
		return sectionHeader(ls('sectionConstants.headers.editorOutput'));
	},
	get GAME_MASTER_OUTPUT() {
		return sectionHeader(ls('sectionConstants.headers.gameMasterOutput'));
	},
	get PREVIOUS_ACT_SUMMARY() {
		return sectionHeader(ls('sectionConstants.headers.previousActSummary', { summarizedScenes: '{summarizedScenes}' }));
	},
	get PREVIOUS_NARRATIVE_BODY() {
		return sectionHeader(ls('sectionConstants.headers.previousNarrativeBody', { completedScenes: '{completedScenes}' }));
	},
	get TURN_OF_EVENTS() {
		return sectionHeader(ls('sectionConstants.headers.turnOfEvents'));
	},
};

/** Section headings for act-plot generation phases (used by act-plot-generator). */
export const ACT_PLOT_SECTION = {
	get WORLD_CONTENT() {
		return actPlotHeader(ls('actPlotSection.headers.worldContent'));
	},
	get PREVIOUS_ACT_SUMMARY() {
		return actPlotHeader(ls('actPlotSection.headers.previousActSummary'));
	},
	get TURN_OF_EVENTS() {
		return actPlotHeader(ls('actPlotSection.headers.turnOfEvents'));
	},
	get INTERVIEW_TRANSCRIPT() {
		return actPlotHeader(ls('actPlotSection.headers.interviewTranscript')) + ls('actPlotSection.descriptions.interviewTranscript');
	},
	get WRITER_OUTPUT() {
		return actPlotHeader(ls('actPlotSection.headers.writerOutput'));
	},
	get REVIEWER_FEEDBACK() {
		return actPlotHeader(ls('actPlotSection.headers.reviewerFeedback'));
	},
	get TEMPLATE() {
		return actPlotHeader(ls('actPlotSection.headers.template'));
	},
};

/** Format the previous narrative body as a user message section. Returns empty array if no body. */
export function formatPreviousNarrativeBody(previousNarrativeBody: string | null | undefined, completedScenes: number): string[] {
	if (!previousNarrativeBody || previousNarrativeBody.trim().length === 0) return [];
	return [
		ls('sectionConstants.headers.previousNarrativeBody', { completedScenes }).replace(/^/, '\n## ').concat('\n') + previousNarrativeBody,
	];
}

/** Format the turn of events as a user message section. Returns empty array if no content. */
export function formatTurnOfEventsSection(turnOfEvents: string | null | undefined): string[] {
	if (!turnOfEvents || turnOfEvents.trim().length === 0) return [];
	return [SECTION.TURN_OF_EVENTS + turnOfEvents];
}
