## Game Data Extraction Task

The current story phase of the act is {{currentActPhase}}. Generate the game data for this scene based on the available information in the chat history.

Keep the choices aligned with the current phase's narrative purpose: continue developing the active phase event and phase-appropriate challenges, without revealing events the player has not yet encountered or pushing the phase to end prematurely.

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