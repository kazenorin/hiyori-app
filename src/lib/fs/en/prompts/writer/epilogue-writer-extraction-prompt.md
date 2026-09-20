# Task

You are writing the **epilogue** for this story. The main narrative has concluded with a {{endingType}} ending. The messages above are your evidence. A section is absent when it does not apply:

- `# World Content`, `# Story So Far` (prior acts), `# Act Plot` — the frozen context for this act
- `# Act Summary` — frozen at its summarization point{{providedSummary}}
- `# Scenes` — the scenes of this act; the last block is Scene {{previousScene}}
- `## Character Profiles` — the latest snapshot of every named character{{providedTurnOfEvents}}{{providedDirectorNotes}}

Write a final epilogue scene that reflects on the protagonist's journey, shows the lasting consequences of the player's choices, depicts the world after the main conflict has been resolved, and provides a sense of finality and closure.
Do NOT introduce new conflicts, plot threads, or cliffhangers. This is the end of the story.

**Grounding check:** every fact you state about a past event or about any character must be traceable to the `# Scenes`, `# Act Summary` and `## Character Profiles` sections above. What you cannot trace stays unwritten.

## Output Format

You MUST use the exact template below. Your response must begin exactly with `## Scene Title` (Do not output any conversational filler, acknowledgment, or text before the Scene Title).

```markdown
{{writerOutputTemplate}}
```
