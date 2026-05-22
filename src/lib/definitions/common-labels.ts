import { ls } from '$lib/localization';

/** Label for user/player role in interview transcripts. */
export const playerLabel = () => ls('common.labels.player');

/** Label for interviewer/assistant role in interview transcripts. */
export const interviewerLabel = () => ls('common.labels.interviewer');

export const sceneWithNumberLabel = (sceneNumber: number | string) => ls('common.labels.sceneWithNumber', { sceneNumber });
export const nameLabel = () => ls('common.labels.name');
export const locationLabel = () => ls('common.labels.location');
export const aliasesLabel = () => ls('common.labels.aliases');
export const lastUpdateLabel = () => ls('common.labels.lastUpdate');
