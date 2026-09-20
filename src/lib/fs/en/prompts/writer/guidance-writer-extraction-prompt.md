# Task

## Writing task

You are now responsible for writing the story prose for Scene {{currentScene}}, the upcoming scene. The messages above are your evidence. A section is absent when it does not yet apply:

- `# World Content`, `# Story So Far` (prior acts), `# Act Plot` — the frozen context for this act
- `# Act Summary` — frozen at its summarization point{{providedSummary}}
- `# Scenes` — for each recent scene: `### Scene title`, `### Background`, `### Narrative Body`, `### Turn Of Events`, `### Player Response`; the last block is Scene {{previousScene}}, carrying the player's response you continue from
- `# Upcoming Scene Plot` — the Scene Plot planning Scene {{currentScene}}
- `## Character Profiles` — the latest snapshot of every named character{{providedTurnOfEvents}}{{providedDirectorNotes}}

{{scenePriorities}}

Your job is to craft vivid, engaging, and immersive narrative based on the provided information.
You are instructed to prioritize on developing the events as directed by the Scene Plot.
Use the pacing decision from the Scene Plot. If the plot planner allows an expanded word count, you may write up to double the usual length.

Do not use `read-scene` on Scene {{previousScene}} — you already have its full narrative body.

**Grounding check:** every fact you state about a past event or about any character must be traceable to the `# Scenes`, `# Act Summary` and `## Character Profiles` sections above. What you cannot trace stays unwritten.

## Output Format

You MUST use the exact template below. Your response must begin exactly with `## Scene Title` (Do not output any conversational filler, acknowledgment, or text before the Scene Title).

```markdown
{{writerOutputTemplate}}
```
