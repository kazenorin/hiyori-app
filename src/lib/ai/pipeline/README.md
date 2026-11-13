# Narrative Generation Pipeline

> **Last updated:** 2026-11-13 | **Version:** 1.12.0

Multi-phase LLM pipeline that generates narrative prose, game data, and scene plots for interactive fiction.

## Resumability and Background Runs

Runs survive interruptions at two levels:

1. **Background completion** — As long as the app stays open, navigating away (switching story/act line) does not stop a run. Execution is owned by the **run manager** ([`chat/run-manager.ts`](../chat/run-manager.ts)), not by the visible chat UI, so a run keeps going in the background and the UI re-attaches when the act line is opened again.
2. **Phase-level persistence** — After each completed phase, the accumulated `PipelineState` and phase metadata are written to the `pipeline_runs` SQLite table. If the app is quit mid-run, the next launch finds the cached row and offers **Continue** (resume from the first incomplete phase) or **Discard**.

A **run** is identified by a pre-created assistant `message_id` and is scoped to one act line (at most one run per line). The cache row exists ⇔ the run is incomplete; it is deleted on completion or discard.

### Resume gates

Resuming seeds `PipelineState` from the cache (`PipelineInput.initialState`) and re-enters the same orchestration. Each step short-circuits when its output already exists, so no completed LLM phase is re-run:

| Step                   | Skipped when                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| Writer                 | `state.writerOutput !== undefined`                                                                  |
| Reviewer               | `state.reviewerOutput !== undefined`                                                                |
| Editor                 | `state.editorOutput !== undefined` (seeded from Writer when Reviewer is disabled or "accept as-is") |
| Editor Template Fitter | existing gate re-evaluated (`editorHasTemplateMetadata(...)` or no `editorOutput`)                  |
| Game Master            | `state.gameMasterOutput !== undefined`                                                              |
| Plot Planner           | `state.scenePlot !== undefined` (GM-only carry-forward stores `''`)                                 |
| GM Template Fitter     | existing gate re-evaluated                                                                          |

Deterministic, non-LLM state updates (editor-from-writer seeding, GM-only plot carry-forward) are **not** cached; they are recomputed identically on resume.

### Phase commit hook

`runPipeline` / `runEpiloguePipeline` wrap the phase tracker with `buildCommittingTrackPhase`, which invokes `PipelineExecution.onPhaseCommit(state, phases)` after **every** completed streaming phase. The run manager implements this hook as an upsert into `pipeline_runs` (plus a flush for the web/OPFS backend). Commit failures are logged and never fatal. Because Game Master ‖ Plot Planner run concurrently from the same base state, each is tracked (and thus committed) as soon as it resolves — an interruption or failure of one sibling cannot lose the other's output — and the wrapper merges each phase result into an accumulated `cacheState` before committing so the snapshot stays whole.

When resuming, `buildTrackPhase(initialPhases)` seeds the tracker with cached `PhaseMetadata[]`, and `aggregateMetadataFromPhases()` (in [`phase-executor.ts`](./phase-executor.ts)) recomputes the aggregate usage, so token stats span both sessions.

### Interruption behavior

| Interruption                        | Outcome                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| Switch story / act line (app open)  | Run continues in the background; UI re-attaches on return                       |
| Stop button                         | Run aborts; completed phases stay cached → Continue/Discard                     |
| App quit mid-phase                  | That phase is lost; resume re-runs it from cached predecessors                  |
| App quit between phases             | Resume skips cached phases                                                      |
| Non-abort error (e.g. auth failure) | Run fails but cache is kept → user can fix the cause and Continue               |
| Story / act / act-line deleted      | Cache row deleted; a live run detects the missing row on next commit and aborts |

Tool side effects of cached phases (act-line events such as phase transitions or endings, inventory updates) are kept while a run is interrupted or failed so that Continue sees a consistent state. When a run is **discarded** before its message is ever persisted, the run manager purges those side effects along with the cache row.

## Execution Flow

### Main Pipeline (`runPipeline`)

```
 ┌─ Background chain (starts concurrently, resolves independently) ─────────────┐
 │  Summarizer → Character Profile Compressor → Memory Extraction                │
 └──────────────────────────────────────────────────────────────────────────────┘

 Sequential chain:
   Writer → Reviewer ─→ Editor → [Editor Template Fitter]
                │                      → Important Phrases Extraction (fire-and-forget)
                │                      → Game Master ‖ Plot Planner (concurrent)
                │                           → [GM Template Fitter]
                │
                └─ "accept as-is" ──▶ skip Editor (Writer output = Editor output)
```

### Epilogue Pipeline (`runEpiloguePipeline`)

Runs the pre-editor chain only (Writer → Reviewer → Editor → Template Fitter) with a specialized extraction prompt. No Game Master or Plot Planner phases.

## Phase Details

### Sequential Phases

| Phase                      | Purpose                                                                      | Provider Role    | Output in `PipelineState`                                  | Descriptors        |
| -------------------------- | ---------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------- | ------------------ |
| **Writer**                 | Generates narrative with scene fields + game data                            | `writer`         | `writerOutput`, `writerVariables`                          | Scene + Game Data  |
| **Reviewer**               | Reviews Writer output; rates violations, gives recommendation                | `reviewer`       | `reviewerOutput`                                           | None (raw content) |
| **Editor**                 | Refines prose based on review                                                | `editor`         | `editorOutput`, `editorVariables`, `editorReasoning`       | Scene only         |
| **Editor Template Fitter** | Restructures Editor output to match template format when metadata is missing | `minorTaskAgent` | `editorVariables` (merged), `editorOutput` (re-serialized) | Scene only         |
| **Game Master**            | Produces game data (decisions, plot threads) from edited narrative           | `gameMaster`     | `gameMasterOutput`, `gameData`                             | Game Data only     |
| **GM Template Fitter**     | Restructures GM output to match template when `decisions` array is empty     | `minorTaskAgent` | `gameData` (merged)                                        | Game Data only     |
| **Plot Planner**           | Generates next scene's plot                                                  | `plotPlanner`    | `scenePlot`                                                | None (raw content) |

### Background Phases

These phases run concurrently with the sequential chain and outlive it; they are ordinary pipeline phases, not a separate class. The chain resolves after the main run settles.

| Phase                            | Purpose                                                                                             | Provider Role          | Output / pane content                                                                                   | Mode                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **Summarizer**                   | Updates act summary (full or incremental)                                                           | `summarizer`           | `actSummary`                                                                                            | Streaming (`streamWithRetry`) |
| **Character Profile Compressor** | Updates character profiles via `update-character-profile` tool calls when interval threshold is met | `summarizer`           | `profileCompressionLog` (per-character tool-call activity log); profile versions persist via tool calls | Streaming (tool calls)        |
| **Memory Extraction**            | Extracts character memories, locations, inventory into vector DB                                    | `memory` + `embedding` | (persists directly)                                                                                     | Non-streaming                 |

## Conditional Phase Execution

- **Reviewer** — gated by `isReviewerEnabled()`. When disabled, Writer output is passed through as both `writerOutput` and `editorOutput`/`editorVariables`.
- **Editor** — skipped when `reviewerAcceptsAsIs()` returns true (violations = 0, recommendation = "accept as-is").
- **Editor Template Fitter** — runs only when `editorHasTemplateMetadata()` is false (no `sceneTitle` in variables) AND `editorOutput` exists.
- **GM Template Fitter** — runs only when `gameData.decisions` is empty AND `gameMasterOutput` exists.
- **Plot Planner** — gated by `isPlotPlannerEnabled()`. Even when enabled, GM may run alone (carrying forward previous `scenePlot`) if the re-evaluation frequency hasn't elapsed. Runs concurrently with GM via `Promise.all` when it does run.
- **Important Phrases Extraction** — fire-and-forget, gated by `isPhraseHighlightingEnabled()`.
- **Background phases** — only run when `player.playerResponse` exists and `completedScenes > 0`.
- **Character Profile Compressor** — only runs when `characterProfileCompressorInterval > 0` and enough scenes have elapsed since the last compression.

On resume these conditions are re-evaluated with current settings, but cached outputs always win: a phase whose output is present in the seeded `PipelineState` never re-runs (see [Resume gates](#resume-gates)).

## Plot Modes

The pipeline supports two plot modes stored on `ActLineMeta.plotMode`:

- **`guidance`** — Plot Planner always runs (when enabled). Writer uses `writerRole` + the `guidanceWriterExtractionPrompt` task.
- **`phaseEvent`** — Narrative advances through act phases (`introduction` → `rising-action` → `climax` → `falling-action` → `resolution`). Writer uses `writerRole` + the `phaseEventWriterExtractionPrompt` task (which resolves the act-phase progression placeholders and the act-end instruction), and the Plot Planner and Game Master select their `phaseEvent…` extraction prompts.

## Prompt Variable Replacement

Prompts use `{{variable}}` placeholders resolved at runtime by `runners.ts` (via `.replaceAll`):

| Placeholder                                                | Used By                                | Source                                                      |
| ---------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| `{{generalInstructions}}`                                  | Writer, Reviewer, Editor, Plot Planner | `LoadedPrompts.generalInstructions`                         |
| `{{targetWordCount}}`                                      | Writer, Editor, Plot Planner           | `settings.targetWordCount ?? 400`                           |
| `{{writerOutputTemplate}}`                                 | Writer, Editor                         | `LoadedPrompts.writerOutputTemplate`                        |
| `{{memoryToolsInstruction}}`                               | Writer, Reviewer, Plot Planner         | Emitted only when `isMemoryAvailable()`; else blank line    |
| `{{inventoryToolsInstruction}}`                            | Writer, Reviewer, Plot Planner, GM     | Emitted only when `isInventoryAvailable()`; else blank line |
| `{{acceptAsIs}}`                                           | Reviewer                               | Localized label                                             |
| `{{summary}}`, `{{totalViolations}}`, `{{recommendation}}` | Reviewer                               | Localized labels                                            |
| `{{additionalRules}}`                                      | Game Master extraction                 | Currently always empty; placeholder kept for future use     |

Every phase shares one system prompt (`mainChatSystemPrompt` with `{{generalInstructions}}` substituted); role framing now lives inside each phase's extraction prompt. The GM extraction prompt resolves `{{currentScene}}`, `{{inventoryToolsInstruction}}`, `{{additionalRules}}`, and (in `phaseEvent` mode) `{{currentActPhase}}` and `{{actPhaseBoundaries}}`.

Writer extraction prompts resolve: `{{previousScene}}`, `{{currentScene}}`, `{{providedSummary}}`, `{{providedTurnOfEvents}}`, `{{providedDirectorNotes}}`, and `{{scenePriorities}}` (a whole-line block assembled by `resolveScenePriorities` from the end-of-act instruction plus the turn-of-events and Director's Notes reinforcement phrases; `substituteToolsLine` deletes the line entirely when nothing applies). The `phaseEvent` variant additionally resolves `{{currentActPhase}}`, `{{currentActPhaseProgress}}`, `{{estimatedPhaseLength}}`, `{{earlyPhaseThreshold}}`, and `{{latePhaseThreshold}}`.

## Context Passing

Narrative context is passed as **user messages** (not system prompts). Every phase in a run shares one **tiered, byte-identical prefix** assembled once from a `PipelineContext` (Tiers 0–2) and appended to by `buildPhaseMessages`, so the phases' request prefixes are identical across a turn and append-only across turns:

- **Tier 0 — Main Context** (`buildMainContextMessages`): three separate messages — World Content · Story So Far (previous-act summaries) · Act Plot — each leading with an H1 section name and a horizontal rule so the content's own H1 headers do not collide. Blank sections are omitted. Frozen for the act.
- **Tier 1 — Summaries** (`buildSummariesMessage`): the serialized Act Summary snapshot at the current summarization point (it leads with its own `# Act Summary` H1), emitted only when an SP has resolved and the snapshot has content. Character Profiles are deliberately excluded here.
- **Tier 2 — Scenes** (`buildScenesSections`): append-only raw scene blocks from the summarization point (or scene 1) up to the last completed scene, each folding the player response that followed it. The Upcoming Scene Plot is emitted as its own `# Upcoming Scene Plot` message (H1 + horizontal rule) after Scenes — it changes every turn, so keeping it out of the Scenes block lets that message stay byte-stable turn-to-turn. Character Profiles follow Scenes as their own section — they change every turn too, so they sit last in the shared prefix to keep Tiers 0–2 stable.

On top of the shared prefix each phase appends its **Tier 3 tail**: prior phase outputs (Writer Output for the Reviewer; Writer + Reviewer Output for the Editor; Editor Output for the Game Master and Plot Planner), the phase extraction prompt, and Director Notes.

The background phases (Summarizer and Character Profile Compressor) share the same prefix. Their Tier 3 tails are:

- **Summarizer** — the latest act summary (up to the previous scene), the extraction prompt (incremental or full), and a final line naming the scene to summarize.
- **Compressor** — the **new** act summary produced by the Summarizer, the existing character profiles as a baseline reference (each entry includes its canonical name so updates keep character identity), then the extraction prompt.

### Prompt caching

`run-manager.ts` builds the `PipelineContext` once per run (resolving the summarization point, act-summary snapshot, character profiles, and scene sections) and reuses it for every phase, so the shared prefix is byte-identical across phases within a turn. `extractCacheTokens()` records `cacheReadTokens`/`cacheWriteTokens` from providers that report them. Caching is strictly **per model**, so phases assigned to different provider roles cannot share a cache regardless of layout.

## Module Structure

| File                 | Responsibility                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.ts`           | Orchestrator. `runPipeline()` and `runEpiloguePipeline()` entry points. Wires phases together, builds `PipelineRunContext`, tracks phase metadata, applies resume gates, commits the phase cache.                  |
| `types.ts`           | Shared types: `PipelineState`, `PipelineInput`, `PipelineResult`, `PipelineCallbacks`, provider configs, context interfaces. Includes resume seeds (`initialState`, `initialPhases`).                              |
| `runners.ts`         | Phase runner functions (`runWriterPhase`, `runReviewerEditorPhases`, `runGamePhases`, etc.), `PipelineRunContext`, `PipelinePrompts`, `buildStateUpdate` closures, phase-specific prompt resolution.               |
| `phase-executor.ts`  | Generic phase execution engine. `executeStreamingPhase()` with retry logic, `runNonStreamingPhase()` for the transcript-regen backfill, metadata aggregation (`aggregateMetadata`, `aggregateMetadataFromPhases`). |
| `message-builder.ts` | Shared-prefix message assembly (`buildPhaseMessages` and the Tier 0–1 builders), act summary formatters, `mergeVariables`/`mergeGameData` for template fitters.                                                    |
| `summarizer.ts`      | Summarizer sub-pipeline (full/incremental), Character Profile Compressor, `runBackgroundPhases()` orchestrator.                                                                                                    |
| `compression-log.ts` | Deterministic per-attempt markdown formatter for the compressor activity log.                                                                                                                                      |
| `prompt-loader.ts`   | Prompt loading via `PromptLoader` instances. `loadPrompts()` resolves story-specific overrides or bundled defaults.                                                                                                |

### Related modules outside `pipeline/`

| Module                                             | Responsibility                                                                                                                                                                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`chat/run-manager.ts`](../chat/run-manager.ts)    | Run lifecycle owner. Keeps one `RunSession` per act line, drives background completion, persists/loads the phase cache, and exposes `startMainRun`, `startEpilogueRun`, `resumeInterruptedRun`, `discardRun`, `abortRun`, and cleanup hooks used by the delete flows. |
| [`db/pipeline-runs.ts`](../../db/pipeline-runs.ts) | CRUD for the `pipeline_runs` phase-cache table (upsert, load by act line/message, `updatePipelineRunIfExists`, scoped deletes).                                                                                                                                       |
| [`chat.svelte.ts`](../chat.svelte.ts)              | Chat UI state. Subscribes to run-manager events and mirrors only the _displayed_ act line's run into the visible message list; renders the Continue/Discard prompt for interrupted runs.                                                                              |

## Import Graph (acyclic)

```
types.ts ← (no pipeline imports)
       ↑
phase-executor.ts ← types, chat-stream, streaming, provider
       ↑
message-builder.ts ← types, narrative-types, template-renderer, definitions
       ↑
prompt-loader.ts ← fs/prompts
       ↑
summarizer.ts ← phase-executor, message-builder, types, act-summary-parser, tools, definitions
       ↑
runners.ts ← phase-executor, message-builder, types, descriptors, settings, definitions
       ↑
index.ts ← runners, phase-executor, message-builder, summarizer, prompt-loader, types
```

## Key Interfaces

All interfaces are defined in [`types.ts`](./types.ts). Key types to know:

- **`PipelineContext`** — The shared prompt-prefix data (Tiers 0–2: world content, act plot, story-so-far, act-summary@SP, character profiles, scene sections). Assembled once per run and reused byte-identically by every phase.
- **`CommonPipelineInput`** — Entry point parameters for `runPipeline`/`runEpiloguePipeline`: orchestration (`execution`, `story`, `assistant`, `completedScenes`, `targetWordCount`, `retryConfig`), background inputs (`latestActSummary`, `previousNarrativeVariables`), narrative bits (`directorNotes`, `previousScenePlot`), the resume seeds (`initialState`, `initialPhases`), and the pre-built `context`. Prompt-prefix data lives only on `context`, not duplicated here.
- **`PipelineInput`** — Extends `CommonPipelineInput` with `player` (the current player response, for the background chain).
- **`PipelineState`** — Mutable state accumulated across phases (writer/editor/GM output, variables, game data). This is what gets cached in `pipeline_runs.state`.
- **`PipelineCallbacks`** — Lifecycle hooks: `onPhaseStart`, `onPhaseStream`, `onPhaseRetry`, `onPhaseComplete`, `onError`, `onPhrasesExtracted`, `onAllComplete`.
- **`PipelineExecution`** — Holds `abortSignal`, `callbacks`, optional `tools`, and `onPhaseCommit(state, phases)` for persisting the phase cache after each phase.
- **`PipelineRunContext`** — Shared context passed to all phase runners (defined in [`runners.ts`](./runners.ts)). Contains `sharedParams`, `providerConfigs`, `prompts`, `effectiveTargetWordCount`, `currentScene`, the narrative scalars (`completedScenes`, `directorNotes`, `previousScenePlot`, `previousTurnOfEvents`), `tools`, `story`, `assistant`, `narrativeOverrides` (writer-tool overrides merged into writer variables, fill-when-missing), the `context` prefix, and `compression` (the per-run `ProfileCompressionState` holder).
- **`PipelineProviderConfigs`** — Per-phase provider resolution. Built by `buildPipelineProviderConfigs()` ([`chat/pipeline-config.ts`](../chat/pipeline-config.ts)) which resolves role-specific configs with fallback to `main`. Roles: `plotPlanner`, `writer`, `reviewer`, `editor`, `gameMaster`, `summarizer`, `minorTaskAgent`.

## Streaming Architecture

### Data Flow

```
executeStream (streaming.ts) — Vercel AI SDK streamText()
  → StreamCallbacks { onTextDelta, onReasoningDelta?, onComplete, onError }
    → createStreamAccumulator (chat-callbacks.ts)
      → createParserChain (parser-chain.ts)
        → createNarrativeStreamParser — chat-stream-parser with OutputDescriptors
      → StreamState { content, reasoning, variables }
```

### Phase Execution Flow

```
executeStreamingPhase (phase-executor.ts)
  → streamWithRetry (chat-stream.ts) — retry with linear backoff, abort-aware
    → streamChatResponse — creates model, accumulator, calls executeStream
  → buildStateUpdate — maps StreamState → Partial<PipelineState>
  → trackPhase (committing wrapper, index.ts)
      — aggregates metadata, records phase entry
      — merges the phase output into the accumulated cache state
      — invokes execution.onPhaseCommit(state, phases) to persist the cache
```

### Descriptors

Each streaming phase declares `OutputDescriptor[]` that tells the stream parser which markdown sections to route into which `NarrativeVariables` fields:

- **Writer**: Scene descriptors + Game Data descriptors → `getNarrativeDescriptors()`
- **Reviewer**: No extraction → `[]`
- **Editor**: Scene descriptors only → `getEditorDescriptors()`
- **GM**: Game Data only → `getGameMasterDescriptors()`
- **Plot Planner**: No extraction → `[]`
- **Template Fitters**: Scene only (editor) or Game Data only (GM)

### `StreamState` — Per-Phase Streaming State

Defined in [`chat-callbacks.ts`](../chat-callbacks.ts). Contains `content` (accumulated raw text), `reasoning` (extracted from `<think>` tags), and `variables` (parsed structured fields).

`fullOutput(ss)` (in [`message-builder.ts`](./message-builder.ts)) reconstructs the complete text from `StreamState` — uses `variablesToMarkdown()` when structured fields are present, falls back to `content`.

## NarrativeVariables

Defined in [`narrative-types.ts`](../narrative-types.ts). The structured output that flows through the pipeline, with fields: `sceneTitle`, `background`, `narrativeBody`, `turnOfEvents`, `cg`, `gameData`.

### GameDataFields

Also in [`narrative-types.ts`](../narrative-types.ts). Contains `activePlotThreads`, `decisionContext`, and `decisions` (renders as clickable buttons in UI).

## Summarizer Sub-Pipeline

### Incremental vs Full

- **Incremental** (`generateIncrementalSummary`): Used when an existing `actSummary` is present. Tail = existing summary + new scene's extraction prompt, asks for just the new scene's contribution, then merges with `mergeActSummary()`. Falls back to full generation on parse/merge failure.
- **Full** (`generateFullSummary`): Used when no act summary exists. Tail = full-summary extraction prompt over the shared prefix, generates the complete summary from scratch.

The pipeline path streams via `streamWithRetry()` (raw-content descriptors, runner-owned lifecycle); the transcript branch keeps `runNonStreamingPhase()` (`generateText()`). Both use the shared system prompt (`mainChatSystemPrompt` with `{{generalInstructions}}` substituted — same as every other phase) on top of the shared prefix.

**Transcript branch (legacy):** when `generateFullSummary` receives a `transcript` (one-off UI backfill via regenerate-metadata), it keeps the old bespoke layout — the role prompt as system prompt, transcript user messages, no tools — with no cache sharing. The pipeline path requires a `PipelineContext`.

### Character Profile Compressor

Runs after the Summarizer when `characterProfileCompressorInterval` scenes have elapsed since the last compression. Input is the shared prefix plus the **new** act summary and the existing profiles baseline (each entry includes its canonical name), so it evolves existing profiles instead of re-deriving them.

The compressor produces no markdown profile document. It updates profiles through per-character `update-character-profile` tool calls ([`tools/update-character-profile.ts`](../tools/update-character-profile.ts)); each successful call inserts a new profile version row at the compressed scene:

- **Changed-only policy** — the model calls the tool only for characters whose fields the new material justifies changing, and emits only changed fields. Unchanged characters get no new version row.
- **Tri-state merge** — per field: omitted keeps the existing value, `null` clears it, a value sets it. `logline` clears to `''` (the column is NOT NULL); traits clear with an empty list.
- **Additive aliases** — the call lists only NEW aliases; existing aliases are unioned in and can never be removed. Identity resolves via `getLatestProfileByAlias` (canonical name or any known alias); an unknown name derives a fresh canonical identity.
- **sceneDetails** are rebuilt deterministically from the new act summary (`serializeCharacterSceneDetails`), not from model output.

**Recording matrix (D4):** after the phase, compression is recorded (`recordCharacterProfileCompression` advances the interval gate to the compressed scene) iff `successCount > 0 || attemptCount === 0` — at least one update succeeded, or the model made no tool calls at all (a quiet run is a legitimate no-change outcome). If every attempt failed, compression is NOT recorded and the gate retries next turn.

The phase pane shows a per-character activity log: each `update-character-profile` attempt renders its supplied fields (changed-only) plus the tool result, captured via an observer on the run-scoped `ProfileCompressionState` holder. A quiet run shows a localized no-changes marker. All-failed runs keep the chip and failure log but are not recorded (D4/D10).

## AI Tools

`buildTools(storyId, actLine, assistant, overrides, compression)` assembles all available tools (`compression` is the per-run `ProfileCompressionState` holder consumed by `update-character-profile`). `guardToolsForPhase(allTools, phase)` keeps an identical schema for every phase (so the tool block stays inside the cacheable prefix) while side-effecting tools outside their allowed phase no-op with a short message. The background compression phases use `guardToolsForBackgroundPhase(allTools, phase)` instead — a **strict** guard where every tool outside the allow-list no-ops, read-only tools included:

| Phase                        | Available Tools                                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WRITER                       | `read-scene`, `read-distant-scene`, `query-memories`, `query-inventory`, `evaluate-risk`, `advance-phase`, `end-act`, `introduce-character`, `character-details`, `set-scene-title`, `suggest-character-name` |
| REVIEWER                     | `read-scene`, `read-distant-scene`, `query-memories`, `query-inventory`, `character-details`                                                                                                                  |
| EDITOR                       | (none)                                                                                                                                                                                                        |
| GAME_MASTER                  | `read-scene`, `read-distant-scene`, `query-memories`, `query-inventory`, `update-inventory`, `character-details`                                                                                              |
| PLOT_PLANNER                 | `read-scene`, `read-distant-scene`, `query-memories`, `query-inventory`, `character-details`                                                                                                                  |
| TEMPLATE_FITTER              | (none)                                                                                                                                                                                                        |
| SUMMARIZER                   | (none — strict guard: all tools no-op)                                                                                                                                                                        |
| CHARACTER_PROFILE_COMPRESSOR | `update-character-profile` (strict background guard: all other tools no-op)                                                                                                                                   |

`update-character-profile` is registered in the tool set (its schema is visible to every phase, keeping the prefix byte-identical) but allow-listed only for CHARACTER_PROFILE_COMPRESSOR — every other phase's guard no-ops it.

## Retry and Error Handling

- **Streaming phases**: `executeStreamingPhase()` wraps `streamWithRetry()`. Outer retry loop with `retryCount` budget; inner stream retries deduct from the budget. Abort errors propagate immediately. Auth errors are never retried.
- **Background phases**: Summarizer and Compressor stream via `streamWithRetry()` (inner retry with linear backoff, same as main phases). The compressor sets `allowEmptyText` — a quiet changed-only run legitimately produces no text.
- **Important phrases extraction**: Fire-and-forget with its own `withRetry()` (max 3 attempts, 2s backoff). Failures are logged but never block the pipeline.
- **Memory extraction**: Own `withRetry()` (max 4 attempts, 2s backoff). Per-location retry scope prevents duplicate work.

## Prompt Loading

`loadPrompts(storyId, storyName)` resolves all 17 prompt templates:

- `generalInstructions` — shared general instructions substituted into the system prompt
- `mainChatSystemPrompt` — the single shared system prompt (persona + general instructions + tools note)
- `writerOutputTemplate` — Writer/Editor output template
- `writerRole` — the shared "Your Role" preamble for all three Writer task prompts; carries the `targetWordCount`/`memoryToolsInstruction`/`inventoryToolsInstruction` scaffolding placeholders
- `guidanceWriterExtractionPrompt`, `phaseEventWriterExtractionPrompt`, `epilogueWriterExtractionPrompt` — Writer extraction task, holding only the "Task" section (`guidance`/`phaseEvent` by `plotMode`; the epilogue run selects the epilogue variant); concatenated after `writerRole` before substitution
- `reviewerExtractionPrompt`, `quickReviewerExtractionPrompt` — Reviewer extraction task (selected by `isQuickReview()` in the runner)
- `editorExtractionPrompt` — Editor extraction task
- `guidancePlotPlannerExtractionPrompt`, `phaseEventPlotPlannerExtractionPrompt` — Plot Planner extraction task (selected by `plotMode`)
- `guidanceGameMasterExtractionPrompt`, `phaseEventGameMasterExtractionPrompt` — Game Master extraction task (selected by `plotMode`)
- `summarizerPrompt`, `summarizerIncrementalPrompt` — Summarizer
- `characterProfileCompressorPrompt` — Character Profile Compressor

Each uses a `PromptLoader` instance that checks for a story-specific override file before falling back to the bundled default. `preparePipelinePrompts()` then narrows these into the `PipelinePrompts` struct used at runtime (the fourteen pipeline prompts above; the Summarizer prompts are consumed separately).

## Adding a New Phase

1. Add the phase name to `PhaseName` in `narrative-types.ts`.
2. Add a `PHASE_TOOLS` entry in `tools.ts` specifying which tools the phase can use.
3. Add output fields to `PipelineState` in `types.ts`.
4. Create descriptors in `descriptors.ts` if the phase extracts structured fields.
5. Add a per-phase extraction prompt (FS markdown, both locales) carrying the phase's role framing and task; assemble messages with `buildPhaseMessages(ctx.context, priorOutputs, extractionPrompt, directorNotes)`.
6. Write the runner function in `runners.ts` — follow the pattern of `runWriterPhase`:
   - Use `resolveSharedSystemPrompt(ctx.prompts)` and resolve the extraction prompt's `{{...}}` placeholders
   - Call `executeStreamingPhase()` with descriptors, messages, provider config, and `buildStateUpdate`
   - Return the state via `trackPhase(...)` (this is what triggers `onPhaseCommit`, so the phase is cached automatically)
7. Wire the runner into `runPipeline()` in `index.ts`, deciding whether it's sequential or concurrent.
8. Add a resume gate so a cached output for the new phase is skipped (check the relevant `state` field before running).
9. Add the phase to `PipelineCallbacks.onPhaseStart`/`onPhaseStream`/`onPhaseComplete` handling in `chat.svelte.ts`.

## Note: Act Plot Generator

The act plot generator ([`act-plot/`](../act-plot/)) has its own three-phase Writer → Reviewer → Editor flow and does **not** use this module's phase cache. Its earlier phase results are therefore still lost if generation is interrupted. This is out of scope for the narrative pipeline's resumability, but the same pattern (persist each phase's output and gate re-runs on cached state) could be applied there later if desired. No cross-module coupling is introduced.
