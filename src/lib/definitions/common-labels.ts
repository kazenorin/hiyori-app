import { ls } from './locale-strings';

/** Label for user/player role in interview transcripts. */
export const playerLabel = () => ls('common.labels.player');

/** Label for interviewer/assistant role in interview transcripts. */
export const interviewerLabel = () => ls('common.labels.interviewer');

export const sceneWithNumberLabel = (sceneNumber: number | string) => ls('common.labels.sceneWithNumber', { sceneNumber });
