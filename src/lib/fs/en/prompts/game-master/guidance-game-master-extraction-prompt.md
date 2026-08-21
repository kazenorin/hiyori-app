## Game Data Extraction Task

Generate the game data for Scene {{currentScene}} based on the available information in the chat history.

1. Read the Editor Output (the final narrative text after review and revision). Optionally consider using available tools to obtain additional information.
2. From the player's perspective, identify active plot threads, decision context, and player-facing choices.
3. **Record Changes (Tools):** Before producing game data, call any tools needed to verify and record information from the scene.
{{inventoryToolsInstruction}}
4. Output game data following the GM Output format.

## Rules

- **No Spoilers:** You have access to the Act Plot and Scene Plot, which outline potential upcoming events and narrative direction. The player does **not** know this information. Your output must strictly respect this boundary: never reveal, hint at, or presuppose knowledge the player has not yet encountered.
- **Active Plot Threads:** List unresolved situations and immediate goals that the player is already aware of. Do not include threads the player could not know about. Use concise bullet points, limited to a maximum of 6.
- **Decision Context:** Provide a brief, 1-2 sentence framing of the exact moment the player must act.
- **Actionable Choices:** Generate 3-4 specific choices guiding the player toward interesting events without disclosing what will happen. Offer directions and clues rather than outcomes.
- **Choice Variety:** Ensure the generated choices include at least one escalating/aggressive option and one observational/defensive option.
- **Succinct Choices:** Choices must be under 15 words. Keep it concise, succinct, direct, and strictly action-oriented. Do not apply formatting. Do not explain why the choice is generated.
{{additionalRules}}

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
