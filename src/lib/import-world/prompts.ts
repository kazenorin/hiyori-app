// Centralized LLM prompts for Import World feature
// All user-facing LLM instructions are here for easy review and modification.

// === Act Generation: Context Labels ===
// These prefix messages tell the LLM what each piece of content is.

/** Label preceding the world building settings card content. */
export const WORLD_CARD_LABEL = 'The following message is a world building settings card.';

/** Label preceding the act card content. */
export const ACT_CARD_LABEL = 'The following message is an act card describing the events of the act.';

/**
 * Label preceding a character card content.
 * `{name}` is replaced with the character's name.
 */
export const CHARACTER_CARD_LABEL = 'The following message is a character card for {name}.';

// === Act Generation: Instructions ===

/** Final instruction sent to LLM after all context cards. */
export const ACT_GENERATION_INSTRUCTION = 'Generate a story based on the above settings.';

// === Scene Formatting ===

/**
 * Template for the format-into-scenes prompt.
 * Placeholders: `{rawContent}`, `{narrationTemplate}`
 */
export const SCENE_FORMAT_PROMPT = `The following is raw narrative content for Act {actNumber}.
Format it into the proper narration template structure shown below.
Split the content into appropriate scenes (1-2 scenes maximum).
Preserve all narrative details and character interactions.
Use the exact Markdown template format.

---RAW CONTENT---
{rawContent}

---TEMPLATE FORMAT TO FOLLOW---
{narrationTemplate}

Output ONLY the formatted content, following the template exactly.`;
