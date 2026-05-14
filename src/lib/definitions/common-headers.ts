import { ls } from './locale-strings';

export const worldContentHeader = () => ls('common.headers.worldContent');
export const actPlotHeader = () => ls('common.headers.actPlot');
export const actSummaryHeader = () => ls('common.headers.actSummary');
export const currentSceneHeader = () => ls('common.headers.currentScene');
export const interviewTranscriptHeader = () => ls('common.headers.interviewTranscript');
export const playerResponseHeader = () => ls('common.headers.playerResponse');
export const scenePlotHeader = () => ls('common.headers.scenePlot');
export const writerOutputTemplateHeader = () => ls('common.headers.writerOutputTemplate');
export const writerOutputHeader = () => ls('common.headers.writerOutput');
export const reviewerOutputHeader = () => ls('common.headers.reviewerOutput');
export const reviewerFeedbackHeader = () => ls('common.headers.reviewerFeedback');
export const editorOutputHeader = () => ls('common.headers.editorOutput');
export const gameMasterOutputHeader = () => ls('common.headers.gameMasterOutput');
export const previousActSummaryHeader = () => ls('common.headers.previousActSummary');
export const actSummaryForScenesHeader = (summarizedScenes: number | string) =>
	ls('common.headers.actSummaryForScenes', { summarizedScenes });
export const previousNarrativeBodyHeader = (completedScenes: number | string) =>
	ls('common.headers.previousNarrativeBody', { completedScenes });
export const turnOfEventsHeader = () => ls('common.headers.turnOfEvents');
export const templateHeader = () => ls('common.headers.template');

export function sectionFormat(text: string, headerLevel: number = 2): string {
	return `${'#'.repeat(headerLevel)} ${text}\n\n`;
}
