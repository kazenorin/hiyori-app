# Narrative Generation Pipeline

> **Last updated:** 2026-06-13 | **Version:** 0.5.0

Multi-phase LLM pipeline that generates narrative prose, game data, and scene plots for interactive fiction.

## Execution Flow

### Main Pipeline (`runPipeline`)

```
 ┌─ Async chain (starts concurrently, resolves independently) ──────────────────┐
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

### Async Phases

| Phase                            | Purpose                                                          | Provider Role          | Output in `AsyncPhaseResults`                          | Mode                           |
| -------------------------------- | ---------------------------------------------------------------- | ---------------------- | ------------------------------------------------------ | ------------------------------ |
| **Summarizer**                   | Updates act summary (full or incremental)                        | `summarizer`           | `actSummary`, `summarizerMetadata`                     | Non-streaming (`generateText`) |
| **Character Profile Compressor** | Compresses character profiles when interval threshold is met     | `summarizer`           | `compressorMetadata` (profiles persist directly to DB) | Non-streaming                  |
| **Memory Extraction**            | Extracts character memories, locations, inventory into vector DB | `memory` + `embedding` | (persists directly)                                    | Non-streaming                  |

## Conditional Phase Execution

- **Reviewer** — gated by `isReviewerEnabled()`. When disabled, Writer output is passed through as both `writerOutput` and `editorOutput`/`editorVariables`.
- **Editor** — skipped when `reviewerAcceptsAsIs()` returns true (violations = 0, recommendation = "accept as-is").
- **Editor Template Fitter** — runs only when `editorHasTemplateMetadata()` is false (no `sceneTitle` in variables) AND `editorOutput` exists.
- **GM Template Fitter** — runs only when `gameData.decisions` is empty AND `gameMasterOutput` exists.
- **Plot Planner** — gated by `isPlotPlannerEnabled()`. Even when enabled, GM may run alone (carrying forward previous `scenePlot`) if the re-evaluation frequency hasn't elapsed. Runs concurrently with GM via `Promise.all` when it does run.
- **Important Phrases Extraction** — fire-and-forget, gated by `isPhraseHighlightingEnabled()`.
- **Async phases** — only run when `player.playerResponse` exists and `completedScenes > 0`.
- **Character Profile Compressor** — only runs when `characterProfileCompressorInterval > 0` and enough scenes have elapsed since the last compression.

## Plot Modes

The pipeline supports two plot modes stored on `ActLineMeta.plotMode`:

- **`guidance`** — Plot Planner always runs (when enabled). Writer uses `writerGuidanceExtractionPrompt()`.
- **`phaseEvent`** — Narrative advances through act phases (`introduction` → `rising-action` → `climax` → `falling-action` → `resolution`). Writer uses `writerPhaseEventExtractionPrompt()`. Act-end triggers are injected into the Game Master system prompt when in a `falling-action` or later phase. The Plot Planner uses a separate `phaseEventPlotPlannerSystemPrompt`.

## System Prompt Variable Replacement

All system prompts use `{{variable}}` placeholders resolved at runtime:

| Placeholder                                                | Used By                          | Source                                                  |
| ---------------------------------------------------------- | -------------------------------- | ------------------------------------------------------- |
| `{{generalInstructions}}`                                  | Writer, Editor, GM, Plot Planner | `LoadedPrompts.generalInstructions`                     |
| `{{targetWordCount}}`                                      | Writer, Editor, Plot Planner     | `settings.targetWordCount ?? 400`                       |
| `{{writerOutputTemplate}}`                                 | Writer, Editor                   | `LoadedPrompts.writerOutputTemplate`                    |
| `{{acceptAsIs}}`                                           | Reviewer                         | Localized label                                         |
| `{{summary}}`, `{{totalViolations}}`, `{{recommendation}}` | Reviewer                         | Localized labels                                        |
| `{{additionalRules}}`                                      | Game Master                      | Currently always empty; placeholder kept for future use |

Writer extraction prompts also use: `{{previousScene}}`, `{{currentScene}}`, `{{summarizedScenes}}`, `{{providedSummary}}`, `{{providedTurnOfEvents}}`, `{{providedDirectorNotes}}`, `{{turnOfEventsReinforcementPhrase}}`, `{{directorNotesReinforcementPhrase}}`, `{{currentActPhase}}`, `{{actEndInstruction}}`.

## Context Passing

Narrative context is passed as **user messages** (not system prompts). Two context interfaces determine which sections are included:

### `PreEditorContext` (Writer, Reviewer, Editor)

Sections in order:

1. World Content
2. Act Plot
3. Act Phase (if `phaseEvent` mode)
4. Story So Far (previous act summaries, if act > 1)
5. Act Summary (pruned)
6. Previous Scene Plot
7. Previous Narrative Body
8. Player Response
9. Turn of Events
10. Director Notes
11. Extraction prompt

Additional sections per phase:

- **Reviewer**: Writer Output section
- **Editor**: Writer Output + Reviewer Output sections

### `PostEditorContext` (Game Master, Plot Planner)

Same as PreEditor but:

- **No** World Content section
- **Adds** Editor Output section (between Turn of Events and Director Notes)

## Module Structure

| File                 | Responsibility                                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`           | Orchestrator. `runPipeline()` and `runEpiloguePipeline()` entry points. Wires phases together, builds `PipelineRunContext`, tracks phase metadata.                                                   |
| `types.ts`           | Shared types: `PipelineState`, `PipelineInput`, `PipelineResult`, `PipelineCallbacks`, provider configs, context interfaces.                                                                         |
| `runners.ts`         | Phase runner functions (`runWriterPhase`, `runReviewerEditorPhases`, `runGamePhases`, etc.), `PipelineRunContext`, `PipelinePrompts`, `buildStateUpdate` closures, phase-specific prompt resolution. |
| `phase-executor.ts`  | Generic phase execution engine. `executeStreamingPhase()` with retry logic, `runNonStreamingPhase()` for Summarizer/Compressor, metadata aggregation (`aggregateMetadata`).                          |
| `message-builder.ts` | Per-phase message construction. `PreEditorContext`/`PostEditorContext` section builders, `AbstractPreEditorContext`, act summary formatters, `mergeVariables`/`mergeGameData` for template fitters.  |
| `summarizer.ts`      | Summarizer sub-pipeline (full/incremental), Character Profile Compressor, `runAsyncPhases()` orchestrator.                                                                                           |
| `prompt-loader.ts`   | Prompt loading via `PromptLoader` instances. `loadPrompts()` resolves story-specific overrides or bundled defaults.                                                                                  |

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
summarizer.ts ← phase-executor, message-builder, types, act-summary-parser, definitions
       ↑
runners.ts ← phase-executor, message-builder, types, descriptors, settings, definitions
       ↑
index.ts ← runners, phase-executor, message-builder, summarizer, prompt-loader, types
```

## Key Interfaces

All interfaces are defined in [`types.ts`](./types.ts). Key types to know:

- **`PipelineInput`** — Entry point parameters (extends `CommonPipelineInput` with `previousScenePlot` and `player`).
- **`PipelineState`** — Mutable state accumulated across phases (writer/editor/GM output, variables, game data).
- **`PipelineCallbacks`** — Lifecycle hooks: `onPhaseStart`, `onPhaseStream`, `onPhaseRetry`, `onPhaseComplete`, `onError`, `onPhrasesExtracted`, `onAllComplete`.
- **`PipelineRunContext`** — Shared context passed to all phase runners (defined in [`runners.ts`](./runners.ts)). Contains `sharedParams`, `providerConfigs`, `preEditorCtx`, `prompts`, `effectiveTargetWordCount`, `currentScene`, `tools`, `story`, `assistant`.
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
  → trackPhase — aggregates metadata, records phase entry
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

- **Incremental** (`generateIncrementalSummary`): Used when an existing `actSummary` is present. Sends existing summary + new scene, asks for just the new scene's contribution, then merges with `mergeActSummary()`. Falls back to full generation on parse/merge failure.
- **Full** (`generateFullSummary`): Used when no act summary exists. Sends full transcript or all context, generates complete summary from scratch.

Both use `runNonStreamingPhase()` (AI SDK `generateText()`) rather than streaming.

### Character Profile Compressor

Runs after the Summarizer when `characterProfileCompressorInterval` scenes have elapsed since the last compression. Compresses per-character scene-level summaries into consolidated character profiles (state, goals, relationships, voice).

## AI Tools

`buildTools(storyId, actLine, assistant)` assembles all available tools. `filterToolsForPhase(allTools, phase)` restricts which tools each phase can use:

| Phase                        | Available Tools                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| WRITER                       | `read-scene`, `read-distant-scene`, `query-memories`, `query-inventory`, `evaluate-risk`, `advance-phase`, `end-act` |
| REVIEWER                     | `read-scene`, `read-distant-scene`, `query-memories`, `query-inventory`                                              |
| EDITOR                       | (none)                                                                                                               |
| GAME_MASTER                  | `read-scene`, `read-distant-scene`, `query-memories`, `query-inventory`, `advance-phase`, `end-act`                  |
| PLOT_PLANNER                 | `read-scene`, `read-distant-scene`, `query-memories`, `query-inventory`                                              |
| TEMPLATE_FITTER              | (none)                                                                                                               |
| SUMMARIZER                   | (none)                                                                                                               |
| CHARACTER_PROFILE_COMPRESSOR | (none)                                                                                                               |

## Retry and Error Handling

- **Streaming phases**: `executeStreamingPhase()` wraps `streamWithRetry()`. Outer retry loop with `retryCount` budget; inner stream retries deduct from the budget. Abort errors propagate immediately. Auth errors are never retried.
- **Non-streaming phases**: Summarizer and Compressor use `runNonStreamingPhase()` without retry wrapping (retry is handled at the async orchestration level).
- **Important phrases extraction**: Fire-and-forget with its own `withRetry()` (max 3 attempts, 2s backoff). Failures are logged but never block the pipeline.
- **Memory extraction**: Own `withRetry()` (max 4 attempts, 2s backoff). Per-location retry scope prevents duplicate work.

## Prompt Loading

`loadPrompts(storyId, storyName)` resolves all 12 prompt templates:

- `generalInstructions` — story-specific general instructions
- `writerSystemPrompt`, `writerOutputTemplate` — Writer
- `reviewerSystemPromptTemplate`, `quickReviewerSystemPromptTemplate` — Reviewer
- `editorSystemPrompt` — Editor
- `gameMasterSystemPrompt` — Game Master
- `plotPlannerSystemPrompt`, `phaseEventPlotPlannerSystemPrompt` — Plot Planner
- `summarizerPrompt`, `summarizerIncrementalPrompt` — Summarizer
- `characterProfileCompressorPrompt` — Character Profile Compressor

Each uses a `PromptLoader` instance that checks for a story-specific override file before falling back to the bundled default.

## Adding a New Phase

1. Add the phase name to `PhaseName` in `narrative-types.ts`.
2. Add a `PHASE_TOOLS` entry in `tools.ts` specifying which tools the phase can use.
3. Add output fields to `PipelineState` in `types.ts`.
4. Create descriptors in `descriptors.ts` if the phase extracts structured fields.
5. Create message builder(s) in `message-builder.ts` (or extend existing section builders).
6. Write the runner function in `runners.ts` — follow the pattern of `runWriterPhase`:
   - Build system prompt with variable replacement
   - Call `executeStreamingPhase()` with descriptors, messages, provider config, and `buildStateUpdate`
   - Return the tracked state
7. Wire the runner into `runPipeline()` in `index.ts`, deciding whether it's sequential or concurrent.
8. Add the phase to `PipelineCallbacks.onPhaseStart`/`onPhaseStream`/`onPhaseComplete` handling in `chat.svelte.ts`.
