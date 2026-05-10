# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

**Tauri v2 + SvelteKit 5 desktop app.** Two layers:

- **Frontend** (`src/`): SvelteKit 5 with `adapter-static` in SPA fallback mode. SSR is disabled, prerender is enabled (`src/routes/+layout.ts`). Vite dev server runs on port 1420. Communicates with the Rust backend via `@tauri-apps/api/core` `invoke()`. Uses **Skeleton.dev** (v4) as the design system with Tailwind CSS v4 (`@tailwindcss/vite` plugin). Theme is set via `data-theme` attribute on `<html>` in `app.html`. Global styles are in `src/routes/+layout.css`.
- **Backend** (`src-tauri/`): Rust/Tauri v2. Tauri commands are registered in `src/lib.rs` via `tauri::generate_handler![]`. Entry point is `main.rs` which calls `app_lib::run()`.

### Key config files

- `src-tauri/tauri.conf.json` — app metadata, window config, CSP, build commands
- `src-tauri/Cargo.toml` — Rust dependencies
- `src-tauri/capabilities/default.json` — Tauri permissions
- `svelte.config.js` — adapter-static with `fallback: 'index.html'`
- `vite.config.ts` — port 1420 (must match `tauri.conf.json` `devUrl`)

## Styling Guidelines

**Always use Skeleton.dev and Tailwind CSS utilities — never hardcode color values.**

- **Skeleton.dev components**: Use built-in Skeleton v4 components and `preset` classes for consistent styling
- **Color tokens**: Reference theme variables via Tailwind (e.g., `bg-surface-50`, `text-primary-500`, `border-surface-200-700`)
- **Dark mode**: Skeleton handles automatic dark mode via `data-theme`; don't write custom dark mode selectors
- **Custom CSS**: Only use `+layout.css` for global resets or Skeleton theme customizations; component styles should use Tailwind classes

## Reference Material

Check `local-references/*` for local reference files (if any).

## Database Architecture

**Singleton SQLite** via `@tauri-apps/plugin-sql`. Managed in `src/lib/db/database.ts` (`initDatabase()` / `getDatabase()`).

### Message Types

`Message` (`src/lib/db/messages.ts`) is the canonical DB representation. `MessageRow` maps snake_case DB columns to camelCase. `mapRowToMessage(row)` converts between them. Key convention: `importantPhrases` is a newline-separated string in DB, converted to `string[]` via `parseImportantPhrases()` / `serializeImportantPhrases()`. Use `updateMessageFields(id, fields)` for partial updates on `actSummary`, `scenePlot`, `importantPhrases`.

### Act Line Architecture

Act lines model branching narratives. Each act has one or more act lines (main line plus branches).

**Tables:** `act_line_meta`, `act_lines` (junction), `act_line_premises`, `acts` (with `continues_from_act_line_id` for cross-act branching).

**Key operations** (`src/lib/db/act-lines.ts`): `getMessagesForLine()`, `branchFromLine()`, `batchResolveActLineInfo()`, `getPreviousActSummary()`, `removeOrphanedMessages()`. `removeMessagesFromActLine()` only deletes `messages` rows when no other act line references them (prevents data loss on forked lines).

## Settings Architecture

**`src/lib/stores/settings.svelte.ts`** — Svelte 5 `$state` rune persisted to `localStorage`.

Multi-provider setup with role-based assignment. Each provider has an `id`, `provider` type, `apiType`, `baseURL`, `model`, and `apiKey`. Roles (plotPlanner, writer, reviewer, editor, gameMaster, summarizer, memory, embedding, minorTaskAgent) are assigned to provider configs via `roleAssignments`. Each role falls back to `main` if not explicitly configured. `get<X>ProviderConfig()` functions resolve role → provider config, returning `undefined` if no valid config with API key exists.

`isPhraseHighlightingEnabled()` gates the feature on `settings.importantPhraseHighlighting && !!getMinorTaskAgentProviderConfig()`.

`migrateFromFlatSettings()` detects old flat settings shape and converts to multi-provider.

## Prompt Loading System

`Prompt` class (`src/lib/fs/prompt-loader.ts`) holds a `relativePath` and `defaultContent`, with a `load()` method. `src/lib/fs/prompts.ts` declares all prompts as `Prompt` instances and exports wrapper functions. Bundled defaults are in `src/lib/fs/prompts/` organized by category.

### Resolution Order

1. Story-specific: `<story-folder>/prompt-templates/<relativePath>`
2. Base file: `config/prompt-templates/<relativePath>`
3. Bundled default (in-memory fallback)

`ensureAllBaseConfigs()` creates all registered prompt files on app startup.

## Story Folders

Each story gets a dedicated folder in AppData with its own `general-instructions.md` among other story-based prompts (see objects of type `PromptLoader` defined in `src/lib/fs/prompts.ts`). Folder names are derived from the story name with sanitization and collision handling (UUID suffix). `resolveStoryFolder()` checks the `story_folders` DB table first, then falls back to filesystem scanning.

## Narrative Generation Pipeline

**`src/lib/ai/pipeline.ts`** — `runPipeline()`; **`src/lib/ai/pipeline-types.ts`** — types.

### Execution Flow

```
Sequential chain:
  Writer → Reviewer → Editor → [Template Fitter for Editor]
                                → Important Phrases Extraction (fire-and-forget)
                                → Game Master ‖ Plot Planner (concurrent)
                                  → [Template Fitter for GM]

Async chain (starts concurrently with sequential):
  Summarizer → Memory Extraction
```

1. **Writer** — Streams narrative with `NARRATIVE_DESCRIPTORS` (scene + game data)
2. **Reviewer** — Streams review; if `reviewerAcceptsAsIs()`, skips Editor
3. **Editor** — Streams refined prose with `EDITOR_DESCRIPTORS` (scene fields only)
4. **Template Fitter** — Restructures output to match template format if metadata is missing
5. **Important Phrases Extraction** — Fire-and-forget, gated by `isPhraseHighlightingEnabled()`
6. **Game Master + Plot Planner** — Run in parallel via `Promise.all`

### Descriptors System

**`src/lib/ai/descriptors.ts`** — defines which fields each phase extracts. The stream parser (`src/lib/chat-stream-parser/`) uses these to route structured sections into `NarrativeVariables` or `GameDataFields`:

| Descriptor Set | Used By | Extracts |
|---|---|---|
| `SCENE_DESCRIPTORS` | Writer, Editor, Editor Template Fitter | sceneTitle, background, narrativeBody, cg |
| `GAME_DATA_DESCRIPTORS` | GM, GM Template Fitter | activePlotThreads, decisionContext, decisions |
| `NARRATIVE_DESCRIPTORS` | Writer | scene + game data (combined) |
| `REVIEWER_DESCRIPTORS` | Reviewer | (none — raw text) |
| `PLOT_PLANNER_DESCRIPTORS` | Plot Planner | (none — raw text) |

## Chat State Management

**`src/lib/ai/chat.svelte.ts`** — Svelte 5 runes managing the main chat UI.

`UIMessage` is the UI representation. Key difference from `Message`: `importantPhrases` is `string[]` in UI (parsed), `string` in DB (newline-separated).

### Message Lifecycle

- `newMessage(role, sceneNumber)` — creates blank UIMessage
- `persistMessage(actLineId, message)` — writes to DB + junction table
- `loadActLineMessages(actLineId)` — loads and maps to UIMessages, triggers backfill for missing phrases
- `sendMessage(actLineId, message)` — full pipeline orchestration: builds provider configs (7 roles, falls back to `main`), builds callbacks, calls `runPipeline()`, handles errors

## Dialogue Preprocessor

**`src/lib/utils/dialogue-preprocessor.ts`** — `preprocessDialogue(content, characterNames?, importantPhrases?)` applies highlighting with strict precedence:

**dialogue > highlighted-phrase > character-name**

Each layer masks its regions so subsequent passes can't match inside them.

## Important Phrase Highlighting

Background LLM extraction + UI highlighting. After Editor phase, `extractImportantPhrases()` runs via MinorTaskAgent (fire-and-forget). On `sendMessage()` completion, the promise is resolved and phrases are persisted. On `loadActLineMessages()`, missing phrases are backfilled sequentially. `MarkdownContent.svelte` passes phrases to `preprocessDialogue()`.

## Template Rendering

**`src/lib/ai/template-renderer.ts`** — renders `NarrativeVariables` into the story message template. `renderFromVariables()` renders if `hasTemplateMetadata()` (has `sceneTitle`), otherwise returns empty string. `variablesToMarkdown()` / `gameDataToMarkdown()` serialize back to markdown for LLM history.

## Act Summary System

**`src/lib/ai/act-summary-parser.ts`** — parses and merges structured act summaries. Supports incremental merging: `mergeActSummary(existing, incremental)` appends new scenes, matches characters by name with alias union. The pipeline uses incremental summaries when an existing `actSummary` exists (faster), otherwise generates a full summary.

## Act Plot System

**`src/lib/ai/act-plot-generator.ts`** — generates `act-plot.md` using a Writer → Reviewer → Editor pipeline. Triggered by `ensureActPlot()` when an act line is selected and no act-plot file exists. `createReadActPlotTool()` gives the LLM access to the current act plot during chat.

## AI Tools

**`src/lib/ai/tools/tools.ts`** — `buildTools(storyId, actLineId)` combines all tool sets:

| Tool | File | Purpose |
|---|---|---|
| `query-memories` | `query-memories.ts` | Semantic search over character memories and locations |
| `query-inventory` | `query-inventory.ts` | Search and modify inventory items |
| `evaluate-risk` | `evaluate-risk.ts` | Dice-roll risk evaluation (-1/0/1 outcome) |
| `read-act-plot` | `read-act-plot.ts` | Read the current act plot file |
| `read-scene` | `read-scene.ts` | Read messages for a specific scene number |

## Memory System

Vector-based memory database per story using `sqlite-vec`. **`src/lib/memory/memory.ts`** manages vector storage and search with deduplication (cosine distance threshold). Memory extraction runs after streaming completion: `memory-extraction-pipeline.ts` orchestrates extraction, `memory-extract-parser.ts` parses markdown output into character memories and locations.

The `query-memories` tool supports three search modes: by character + location, by character only, or by location only (with random sampling).

## World Builder

AI-guided interview that creates a story's world document (`src/lib/ai/world-builder.svelte.ts`). Uses `streamChatResponse()` from `chat-stream.ts`. Completion marker: `[WORLD_BUILDER_COMPLETE]` followed by story name and Markdown world document. `createStoryFromWorldBuilder()` in `stories.svelte.ts` creates the story structure.

## Import World

Import existing chat transcripts as new stories (`src/lib/import-world/`). `import-orchestrator.ts` parses transcript files (JSON, Markdown, text), detects game data, generates acts, and creates story structure.

## Streaming Pipeline

```
executeStream (streaming.ts)
  → StreamCallbacks { onTextDelta, onReasoningDelta?, onComplete, onError }
    → createStreamAccumulator (chat-callbacks.ts)
      → createParserChain (parser-chain.ts)
        → ThinkingTagParser → GameDataStreamParser
      → message-updater helpers (applyParserOutput, applyReasoningDelta)
```

`streaming.ts` wraps Vercel AI SDK `streamText()` with callback-driven lifecycle. `chat-callbacks.ts` wires the parser chain and accumulates immutable `StreamState`. `chat-stream.ts` provides the shared `streamChatResponse()` function used by both `chat.svelte.ts` and `world-builder.svelte.ts`, with `streamWithRetry()` for exponential backoff.

**Thinking tags**: The parser extracts `think`-tag blocks during streaming, separating reasoning from visible content.

**Game data blocks**: ```json blocks with `worldState` and `decisions` are intercepted and hidden from chat content. Decisions render as clickable buttons. `toHistoryMessage()` appends game data JSON to message content for LLM history.

## Character and Act Card Generation

- **Character Cards** (`src/lib/ai/character-card-generator.ts`): Extracts characters from an act line, generates cards with personality, appearance, arc info. Uses lineage tracking for previous act context.
- **Act Cards** (`src/lib/ai/act-card-generator.ts`): Generates summary documents for entire acts.

Both use `Prompt` class instances, support parallel generation, and write to story folder under `act-N/characters/`.

## Vector Data Types (sqlite-vec)

The `sqlite-vec` extension is available in all SQLite connections (registered process-globally via `main.rs`). All sqlite-vec SQL functions and the `vec0` virtual table module are available from JavaScript SQL queries.

### Constraints

- **vec0 schema requires explicit dimension**: `float[N]` (e.g., `float[768]`), not bare `float`.
- **Vectors as JSON strings**: `tauri-plugin-sql` IPC cannot bind binary BLOBs from JavaScript. Pass vectors as JSON strings — sqlite-vec parses them natively.
- **Integer primary keys only**: Use `last_insert_rowid()` in SQL instead of passing rowids from JavaScript (JS `number` binds as REAL through IPC).
- **KNN queries require LIMIT on vec0 scan**: When JOINing with other tables, use a subquery pattern so the `LIMIT` is directly on the vec0 virtual table scan.

### Example Usage (JavaScript)

```sql
-- Create a vector table
CREATE VIRTUAL TABLE vec_items USING vec0(embedding float[768]);

-- Insert (vector as JSON string)
INSERT INTO vec_items(rowid, embedding) VALUES (1, '[0.1, 0.2, ...]');

-- Search (top 5 closest by cosine distance)
SELECT rowid, distance
FROM vec_items
WHERE embedding MATCH '[0.3, 0.1, ...]'
ORDER BY distance
LIMIT 5;
```

## IntelliJ MCP Usage

When using IntelliJ MCP tools, first check whether the current shell is WSL2 by running `which wslpath`.

If `wslpath` is available, convert the project path to a Windows path before passing it to IntelliJ MCP:

```bash
$(wslpath -w "$ProjectPath")
```

where `$ProjectPath` is the current project directory.
