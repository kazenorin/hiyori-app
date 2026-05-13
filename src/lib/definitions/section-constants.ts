/** Markdown section headings used in LLM message construction. */
export const SECTION = {
	WORLD_CONTENT: '\n## World Content\n',
	ACT_PLOT: '\n## Act Plot\n',
	ACT_SUMMARY: '\n## Act Summary\n',
	PLAYER_RESPONSE: '\n## Player Response\n',
	SCENE_PLOT: '\n## Scene Plot\n',
	WRITER_OUTPUT_TEMPLATE: '\n## Writer Output Template\n',
	WRITER_OUTPUT: '\n## Writer Output\n',
	REVIEWER_OUTPUT: '\n## Reviewer Output\n',
	EDITOR_OUTPUT: '\n## Editor Output\n',
	GAME_MASTER_OUTPUT: '\n## Game Master Output\n',
	PREVIOUS_ACT_SUMMARY: '\n## Act Summary {summarizedScenes}\n',
	PREVIOUS_NARRATIVE_BODY: '\n## Narrative Body for Scene {completedScenes}\n',
	TURN_OF_EVENTS: '\n## Turn Of Events\n',
} as const;

/** Section headings for act-plot generation phases (used by act-plot-generator). */
export const ACT_PLOT_SECTION = {
	WORLD_CONTENT: '## World Content\n\n',
	PREVIOUS_ACT_SUMMARY: '## Previous Act Summary\n\n',
	TURN_OF_EVENTS: '## Turn Of Events\n\n',
	INTERVIEW_TRANSCRIPT: '## Interview Transcript\n\nThe following is an interview exchange about the story and premises.',
	WRITER_OUTPUT: '## Writer Output\n\n',
	REVIEWER_FEEDBACK: '## Reviewer Feedback\n\n',
	TEMPLATE: '## Template\n\n',
} as const;

/** Format the previous narrative body as a user message section. Returns empty array if no body. */
export function formatPreviousNarrativeBody(previousNarrativeBody: string | null | undefined, completedScenes: number): string[] {
	if (!previousNarrativeBody || previousNarrativeBody.trim().length === 0) return [];
	return [SECTION.PREVIOUS_NARRATIVE_BODY.replaceAll('{completedScenes}', String(completedScenes)) + previousNarrativeBody];
}

/** Format the turn of events as a user message section. Returns empty array if no content. */
export function formatTurnOfEventsSection(turnOfEvents: string | null | undefined): string[] {
	if (!turnOfEvents || turnOfEvents.trim().length === 0) return [];
	return [SECTION.TURN_OF_EVENTS + turnOfEvents];
}
