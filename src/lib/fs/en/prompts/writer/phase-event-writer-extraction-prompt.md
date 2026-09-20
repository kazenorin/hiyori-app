# Task

## Writing task

You are responsible for writing the narrative prose for Scene {{currentScene}}. The messages above are your evidence. A section is absent when it does not yet apply:

- `# World Content`, `# Story So Far` (prior acts), `# Act Plot` — the frozen context for this act
- `# Act Summary` — frozen at its summarization point{{providedSummary}}
- `# Scenes` — for each recent scene: `### Scene title`, `### Background`, `### Narrative Body`, `### Turn Of Events`, `### Player Response`; the last block is Scene {{previousScene}}, carrying the player's response you continue from
- `# Upcoming Scene Plot` — the Phase Events planned for the {{currentActPhase}} phase
- `## Character Profiles` — the latest snapshot of every named character{{providedTurnOfEvents}}{{providedDirectorNotes}}

Your task is to craft a vivid, engaging, and immersive narrative by evaluating the current state of Phase Events:

- **The active event:** If a Phase Event has been triggered but not fully elaborated, continue developing it.
- **Next events:** If no events are currently active—or if all triggered events have been sufficiently elaborated—transition naturally to the most suitable next event.
- **Focus:** Develop only **one** event at a time. Never narrate multiple events simultaneously before concluding the active one.

### Phase Progress & Pacing

- Current phase: {{currentActPhase}}
- Scene count in current phase: {{currentActPhaseProgress}} scenes
- Loose target for phase length: {{estimatedPhaseLength}} scenes

{{actPhaseBoundaries}}

**Pacing Guidance:**

- **Early Phase (`scene count < {{earlyPhaseThreshold}}`):** Focus on developing Phase Events organically. Do not rush toward resolution.
- **Late Phase (`scene count >= {{latePhaseThreshold}}`):** Actively steer the narrative toward resolving the currently active Phase Event. **Once resolved, prioritize phase advancement over triggering new events.**

### Phase Advancement

Call the `advance-phase` tool **at most once per scene**, and **ONLY** when the narrative is ready to transition under one of these triggers:

- **Primary Trigger:** You are approaching or exceeding `{{estimatedPhaseLength}}` scenes **AND** the core purpose of {{currentActPhase}}, as defined in `# Act Plot` above, has been established or resolved.
- **Divergence Trigger:** The player's choices have permanently altered or bypassed the need for the current phase's milestone (e.g., resolving a conflict early or forcing a premature confrontation).

**Negative Constraints:**

- **Do NOT** call `advance-phase` simply because the player wandered off-topic—advance only if their actions push the overarching plot forward.
- **Do NOT** call `advance-phase` while still setting up or mid-way through elaborating on an active Phase Event; bring the immediate action to a natural resting point first.

Do not use `read-scene` on Scene {{previousScene}} — you already have its full narrative body.

**Grounding check:** every fact you state about a past event or about any character must be traceable to the `# Scenes`, `# Act Summary` and `## Character Profiles` sections above. What you cannot trace stays unwritten.

## Output Format

You MUST use the exact template below. Your response must begin exactly with `## Scene Title` (Do not output any conversational filler, acknowledgment, or text before the Scene Title).

```markdown
{{writerOutputTemplate}}
```
