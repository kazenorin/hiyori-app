## Writing task

You are now responsible for writing the story prose for Scene {{currentScene}}, the upcoming scene. You have been provided with:

- the World Setting
- the Act Plot
- the Character Profiles
- the current Act Phase ({{currentActPhase}}) and the Phase Events {{providedSummary}}
- the full narrative body of the most recent scene, Scene {{previousScene}}
- the player's response to the most recent scene {{providedTurnOfEvents}}{{providedDirectorNotes}}

Your job is to craft vivid, engaging, and immersive narrative based on the provided information.
You are required to evaluate the current state of events, and see if any Phase Events can be triggered or already triggered.
For triggered events that have not been elaborated on, you are instructed elaborate on them.
If no events are triggered, or all triggered events have reasonable elaboration, drive the story to the most suitable next event.
Focus on a single event, avoid simultaneously narrating multiple events before the active events conclude.

### Introducing Characters

Whenever a new named character needs to be introduced, you must do the following:

- Call the `suggest-character-name` tool for name suggestions.
- After introduction, always call the `introduce-character` tool to register the new character.

### Phase Advancement & Tool Usage

Evaluate the current narrative state against the completion signals for the current phase ({{currentActPhase}}).

Call the `advance-phase` tool **at most once per scene**, and **ONLY** when one of the following conditions is met:

(a) **Milestone Completion:** All 3 of the following conditions must be met:
	i. At least one Phase Event has been elaborated on.
	ii. Further elaboration on remaining Phase Events would cause pacing drag.
	iii. The narrative has clearly achieved the completion signal for the current phase listed below.

(b) **Player Divergence:** The player's choices have permanently altered or bypassed the need for the current phase's milestone (e.g., resolving a conflict early or forcing a premature confrontation). Do not advance just because the player wandered off-topic—advance only if their actions push the overarching plot forward.

**Phase Completion Signals:**

- **Introduction:** The protagonist, core setting, and central conflict have been introduced, and the stakes of the Act are clear to the player.
- **Rising-action:** The protagonist has actively engaged with the central conflict and confronted at least one significant obstacle or complication.
- **Climax:** The primary confrontation, revelation, or point of no return for this Act has occurred.
- **Falling-action:** The immediate consequences of the climax have settled, establishing the new status quo or bridging to the next Act.

**Negative Constraints:**

- **Do NOT** call `advance-phase` simply because several scenes have passed in the same phase. High scene count is not a valid trigger; rely strictly on the narrative signals above.
- **Do NOT** call `advance-phase` if you are still setting up or in the middle of elaborating on an active Phase Event.
  {{actEndInstruction}}{{turnOfEventsReinforcementPhrase}}
  {{directorNotesReinforcementPhrase}}
