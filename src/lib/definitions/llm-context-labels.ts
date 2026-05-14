import { ls } from './locale-strings';

// === Transcript boundary markers ===

/** Marks the start of an act transcript in LLM messages. */
export const transcriptStart = () => ls('llmContextLabels.labels.transcriptStart');

/** Marks the end of an act transcript in LLM messages. */
export const transcriptEnd = () => ls('llmContextLabels.labels.transcriptEnd');

/** Combined end-of-transcript + template intro for act card generation. */
export const actCardTranscriptEnd = () => ls('llmContextLabels.labels.actCardTranscriptEnd');

// === Context labels ===

/** Labels world content for LLM context. */
export const worldContextLabel = () => ls('llmContextLabels.labels.worldContext');

/** Labels an act card in LLM context. */
export const actCardLabel = (actNumber: number) => ls('llmContextLabels.labels.actCard', { actNumber });

/** Labels a character card from a previous act in LLM context. */
export const characterCardLabel = (characterName: string, actNumber: number) =>
	ls('llmContextLabels.labels.characterCard', { characterName, actNumber });

// === Character extraction prompts ===

/** Prefix for the character extraction user message. */
export const characterExtractionPrefix = () =>
	ls('llmContextLabels.instructions.characterExtractionPrefix', {
		transcriptStart: ls('llmContextLabels.labels.transcriptStart'),
	});

/** Instruction suffix for character extraction. */
export const characterExtractionInstruction = (rules: string) => ls('llmContextLabels.instructions.characterExtraction', { rules });

/** Instruction for character card generation. */
export const characterCardGenerationInstruction = (extractionPrompt: string, template: string) =>
	ls('llmContextLabels.instructions.characterCardGeneration', { extractionPrompt, template });

// === World builder prompts ===

/** Seed message for the world builder interview. */
export const worldBuilderSeed = () => ls('llmContextLabels.instructions.worldBuilderSeed');

/** Prefix for resuming a story act interview. */
export const resumeStoryActPrefix = () => ls('llmContextLabels.instructions.resumeStoryActPrefix');

/** Suffix for resuming a story act interview. */
export const resumeStoryActSuffix = () => ls('llmContextLabels.instructions.resumeStoryActSuffix');

// === Role labels ===

/** Label for user/player role in interview transcripts. */
export const playerLabel = () => ls('llmContextLabels.labels.player');

/** Label for interviewer/assistant role in interview transcripts. */
export const interviewerLabel = () => ls('llmContextLabels.labels.interviewer');

// === Turn of events section headers ===

export const TOE_SECTION = {
	get ACT_SUMMARY() {
		return '### ' + ls('llmContextLabels.headers.toeActSummary');
	},
	get CURRENT_SCENE() {
		return '### ' + ls('llmContextLabels.headers.toeCurrentScene');
	},
	get INTERVIEW_TRANSCRIPT() {
		return '### ' + ls('llmContextLabels.headers.toeInterviewTranscript');
	},
};
