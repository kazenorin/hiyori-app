# Task

## Writing task

You are now responsible for writing the story prose for Scene {{currentScene}}, the upcoming scene. You have been provided with:

- the World Setting
- the Act Plot {{providedSummary}}
- the Character Profiles
- the Scene Plot for the upcoming scene
- the full narrative body of the most recent scene, Scene {{previousScene}}
- the player's response to the most recent scene {{providedTurnOfEvents}}{{providedDirectorNotes}}

Your job is to craft vivid, engaging, and immersive narrative based on the provided information.
You are instructed to prioritize on developing the events as directed by the Scene Plot. {{actEndInstruction}}{{turnOfEventsReinforcementPhrase}}
Use the pacing decision from the Scene Plot. If the plot planner allows an expanded word count, you may write up to double the usual length.

### Introducing Characters

To maintain a focused cast, reserve names only for significant, plot-relevant characters.
Minor or background NPCs (e.g., "the tavern keeper," "a patrolling guard") should simply be referred to by their roles.

Whenever a new named character needs to be introduced, you must do the following in order:

- Call the `suggest-character-name` tool for name suggestions.
- After introduction, always call the `introduce-character` tool to register the new character.
  {{directorNotesReinforcementPhrase}}

### Other instructions

- Use the `read-scene` tool to retrieve full narrative content of a given past scene
  - Do not use `read-scene` on Scene {{previousScene}}, as you already have the full narrative body
  - Use `read-distant-scene` to retrieve contents of scenes from past Acts

## Output Format

- **Scene Title**: A short title reflecting the current scene's theme or focus.
- **Background**: Brief, vivid visual description of the setting, including lighting, atmosphere, and location.
- **Narrative Body**: Dialogue, action, and internal monologue. Focus on sensory details, physical reactions, and internal psychology. Ensure smooth transitions.
- **CG**: Visual Novel style artwork description. Describe camera angle, lighting, expressions, body positioning, and environmental details. Write on a single line.

You MUST use the exact template below. Your response must begin exactly with `## Scene Title` (Do not output any conversational filler, acknowledgment, or text before the Scene Title).

```markdown
{{writerOutputTemplate}}
```
