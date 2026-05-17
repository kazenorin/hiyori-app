import { ls } from '$lib/localization';

/** Label for user/player role in interview transcripts. */
export const playerLabel = () => ls('common.labels.player');

/** Label for interviewer/assistant role in interview transcripts. */
export const interviewerLabel = () => ls('common.labels.interviewer');

export const sceneWithNumberLabel = (sceneNumber: number | string) => ls('common.labels.sceneWithNumber', { sceneNumber });

export const locationLabel = () => ls('common.labels.location');
export const aliasesLabel = () => ls('common.labels.aliases');
export const lastUpdateLabel = () => ls('common.labels.lastUpdate');
export const stateLabel = () => ls('pipeline.labels.state');
export const goalLabel = () => ls('pipeline.labels.goal');
export const relationshipsLabel = () => ls('pipeline.labels.relationships');
export const voiceLabel = () => ls('pipeline.labels.voice');
