## Game Data Extraction Task

Generate the game data for Scene {{currentScene}} based on the available information in the chat history.

1. Read the Editor Output (the final narrative text after review and revision). Optionally consider using available tools to obtain additional information.
2. From the player's perspective, identify active plot threads, decision context, and player-facing choices.
3. **Record Changes (Tools):** Before producing game data, call any tools needed to verify and record information from the scene.
{{inventoryToolsInstruction}}
4. Output game data following the GM Output format.

## Output Format

Produce your game data using the following template:

```markdown
# Game Data

## Active Plot Threads

- [unresolved situation or immediate goal]
- [another thread]

## Decision Context

[brief contextual description of the moment of choice]

## Decisions

- [Specific, actionable choice]
- [Alternative approach or dialogue option]
- [Escalating or aggressive choice]
- [Observational, teasing, or defensive choice]
```