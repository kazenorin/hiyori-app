/** LLM context labels and boundary markers shared across AI generators. */

// === Transcript boundary markers ===

/** Marks the start of an act transcript in LLM messages. */
export const TRANSCRIPT_START = 'The following messages will contain the transcript of the current act:';

/** Marks the end of an act transcript in LLM messages. */
export const TRANSCRIPT_END = 'The previous message was the end of the transcript of the current act.';

/** Combined end-of-transcript + template intro for act card generation. */
export const ACT_CARD_TRANSCRIPT_END =
	'The previous message was the end of the transcript of the current act. The following message will contain the Act Card template:';

// === Context labels ===

/** Labels world content for LLM context. */
export const WORLD_CONTEXT_LABEL = 'The world setting is based on the following:';

/** Labels an act card in LLM context. */
export const ACT_CARD_LABEL = (actNumber: number) =>
	`The following message contains the Act Card from Act ${actNumber}`;

/** Labels a character card from a previous act in LLM context. */
export const CHARACTER_CARD_LABEL = (characterName: string, actNumber: number) =>
	`The following message contains the previous Character Card of ${characterName} from Act ${actNumber}`;

// === Character extraction prompts ===

/** Prefix for the character extraction user message. */
export const CHARACTER_EXTRACTION_PREFIX =
	'I need your help to extract all the characters from the current act.\n' + TRANSCRIPT_START;

/** Instruction suffix for character extraction. */
export const CHARACTER_EXTRACTION_INSTRUCTION = (rules: string) =>
	`Extract all the characters from the current act according to the following rules: ${rules}`;

/** Instruction for character card generation. */
export const CHARACTER_CARD_GENERATION_INSTRUCTION = (extractionPrompt: string, template: string) =>
	`Based on the information from the chat history, generate a new Character Card according to the following rules:\n${extractionPrompt}\n---\n${template}`;

// === World builder prompts ===

/** Seed message for the world builder interview. */
export const WORLD_BUILDER_SEED = 'I want to create a new story. Please help me build a world.';

/** Prefix for resuming a story act interview. */
export const RESUME_STORY_ACT_PREFIX = `Continue the pre-game interview based on the latest story context below.

The content represents what already happened. Use it only as context to understand the player's direction and preferences.

Do NOT continue the story, narrate scenes, or generate plot content. Stay strictly in interview mode.

---`;

/** Suffix for resuming a story act interview. */
export const RESUME_STORY_ACT_SUFFIX = `

---

Resume the interview conversation naturally from here, helping the player refine what they want next.`;

// === Role labels ===

/** Label for user/player role in interview transcripts. */
export const PLAYER_LABEL = 'Player';

/** Label for interviewer/assistant role in interview transcripts. */
export const INTERVIEWER_LABEL = 'Interviewer';

// === Turn of events section headers ===

export const TOE_SECTION = {
	ACT_SUMMARY: '### Act Summary',
	CURRENT_SCENE: '### Current Scene',
	INTERVIEW_TRANSCRIPT: '### Interview Transcript',
} as const;
