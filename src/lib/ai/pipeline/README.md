# Narrative Generation Pipeline

Multi-phase LLM pipeline that generates narrative prose, game data, and scene plots for interactive fiction.

## Execution Flow

```
Sequential chain:
  Writer → Reviewer → Editor → [Template Fitter]
                                → Important Phrases Extraction (fire-and-forget)
                                → Game Master ‖ Plot Planner (concurrent)
                                  → [Template Fitter for GM]

Async chain (starts concurrently with sequential):
  Summarizer → Character Profile Compressor → Memory Extraction
```

- **Reviewer** is gated by settings; when disabled, Writer output is passed through directly as Editor output.
- **Editor** is skipped when the Reviewer indicates "accept as-is" — Writer output becomes Editor output.
- **Template Fitter** runs only when the preceding phase output lacks template metadata.
- **Game Master** and **Plot Planner** run in parallel via `Promise.all` when Plot Planner is enabled.
- **Important Phrases Extraction** is fire-and-forget, gated by `isPhraseHighlightingEnabled()`.
- **Async phases** start concurrently with the sequential chain and resolve independently.

## Module Structure

| File                 | Responsibility                                                                                                                                |
|----------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| `index.ts`           | Orchestrator. `runPipeline()` entry point that wires phases together.                                                                         |
| `types.ts`           | Shared types: `PipelineState`, `PipelineInput`, `PipelineResult`, `PipelineCallbacks`, provider configs.                                      |
| `runners.ts`         | Phase runner functions, `PipelineRunContext`, `PipelinePrompts`, and `buildStateUpdate` closures.                                             |
| `phase-executor.ts`  | Generic phase execution engine. `executeStreamingPhase()`, `runNonStreamingPhase()`, metadata aggregation.                                    |
| `message-builder.ts` | Per-phase message construction. Shared section builders (`buildPreEditorSections`, `buildPostEditorSections`) and per-phase message builders. |
| `summarizer.ts`      | Summarizer, Character Profile Compressor, and async phases orchestration (`runAsyncPhases`).                                                  |
| `prompt-loader.ts`   | Prompt loading via `PromptLoader` instances. `loadPrompts()` resolves story-specific or default prompts.                                      |

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

- **`PipelineInput`** — Entry point parameters: execution config, world content, act context, player info.
- **`PipelineState`** — Mutable state accumulated across phases (writer/editor/GM output, variables, game data).
- **`PipelinePrompts`** — Grouped prompt templates loaded for the current story.
- **`PipelineRunContext`** — Shared context passed to all phase runners: shared params, provider configs, pre-editor context, prompts.
- **`PipelineCallbacks`** — Lifecycle hooks: `onPhaseStart`, `onPhaseStream`, `onPhaseRetry`, `onPhaseComplete`, `onError`, `onAllComplete`.

## Context Passing

Narrative context (world content, act plot, previous scenes, director notes) is passed as **user messages**, not stuffed into the system prompt. `PreEditorContext` is shared by Writer/Reviewer/Editor; `PostEditorContext` (which includes editor output) is shared by Game Master and Plot Planner.
