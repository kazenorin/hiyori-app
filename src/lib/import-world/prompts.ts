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
export const ACT_GENERATION_INSTRUCTION = `Generate a story based strictly on the settings and information provided above.  
Your top priorities are: (1) accuracy to source material, (2) consistency in character portrayal and tone, and (3) clear scene-based structure.

Ensure all characters act and speak consistently with their established personalities, motivations, and relationships.  
Maintain the specified tone (e.g., gritty realism, whimsical fantasy, etc.) throughout the story.  
Present the story in prose format divided into clear scenes, not as a screenplay or dialogue script.

You may introduce small original details only when necessary for flow or realism, and only if they support rather than alter the existing lore or character logic.

Each scene should focus on one significant narrative event or emotional turning point.  
Scenes should be comparable in length and detail (roughly 300–500 words each), detailed enough to cover the event fully before moving on.  
Begin each scene with a short transition (except Scene 1) to connect it logically to the previous moment.  
End each scene with a sense of resolution or a hook leading into the next.

IMPORTANT: Structure your response using markdown headers to separate distinct scenes.  
Use ## Scene, ### Scene X, or similar header levels to mark the beginning of each new scene.

Example format:
## Scene 1: [Scene Title]  
[Story content...]

## Scene 2: [Scene Title]  
[Story content...]

## Scene 3: [Scene Title]  
[Story content...]

Each scene should be a self-contained segment with a clear beginning and end.`;

// === Scene Formatting ===

/**
 * Prompt for the first scene extraction (no prior scenes).
 * Uses default system prompt for the main chat.
 */
export const SCENE_EXTRACTION_FIRST_PROMPT = `You will rewrite the following scene using the narration template provided below.  
Your primary goal is to **fit the scene into the given narration template and style**, preserving all essential content and character actions from the original scene.

Apply the same narrative style, structure, and formatting conventions as shown in the template.  
Include vivid sensory descriptions, character dialogue, internal thoughts, and environment updates where appropriate for flow and immersion.  
Do not omit key story details or add new plot elements beyond what is needed for smooth narrative transitions and natural pacing.

Present only the rewritten scene — do not include explanations, notes, or commentary outside the story output.

---NARRATION TEMPLATE---
{narrationTemplate}

---SCENE CONTENT---
{sceneContent}`;

/**
 * Prompt for subsequent scene extraction (with prior scenes as history).
 * Includes previous scenes for continuity.
 */
export const SCENE_EXTRACTION_CONTINUATION_PROMPT = `Below are the previous scenes from this act for context:
---PREVIOUS SCENES---
{previousScenes}

You will rewrite the next scene using the narration template provided below.  
Your primary goal is to **apply the narration template faithfully while maintaining full consistency with the previous scenes** in tone, pacing, and style.  

Continue the story smoothly from where the previous scenes left off, ensuring logical continuity in plot, character actions, and emotional flow.  
Preserve all key content from the original scene; add only minor descriptive or connective details when necessary for realism or narrative cohesion.

Apply the same narrative style, structure, and formatting conventions as the template.  
Do not restate previous scenes or summarize them — focus only on rewriting the current scene as part of the ongoing narrative.

Present only the rewritten scene — do not include explanations, notes, or commentary outside the story output.

---NARRATION TEMPLATE---
{narrationTemplate}

---SCENE CONTENT---
{sceneContent}`;
