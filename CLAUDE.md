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

- **Skeleton.dev components**: Use built-in components (buttons, cards, inputs, etc.) and their `variant` props for consistent styling
- **Color tokens**: Reference theme variables via Tailwind (e.g., `bg-surface-50`, `text-primary-500`, `border-surface-200-700`)
- **Typography**: Use `preset-typography` classes for text sizing
- **Spacing**: Use Tailwind spacing scale (`p-4`, `gap-2`, etc.)
- **Dark mode**: Skeleton handles automatic dark mode via `data-theme`; don't write custom dark mode selectors
- **Custom CSS**: Only use `+layout.css` for global resets or Skeleton theme customizations; component styles should use Tailwind classes

## Reference Material

Check `local-references/*` for local reference files (if any).

## Lodash Usage

The project uses lodash-es for common utility operations. Import from `lodash-es` (not `lodash`):

- `clamp` — clamping values to a range
- `kebabCase` — string to kebab-case for file naming
- `omitBy` — removing object entries by predicate
- `maxBy` — finding max element by property
- `findLastIndex` — finding last matching index
- `sampleSize` — random sampling from arrays
- `set` — deep path assignment (used by stream parser for `outputPath`)

## Database Architecture

**Singleton SQLite** via `@tauri-apps/plugin-sql`. Managed in `src/lib/db/database.ts`:

- `initDatabase()` — lazy initialization, loads `sqlite:byoa.db`
- `getDatabase()` — returns the singleton (throws if not initialized)

### Schema Migrations

Migrations are in `src/lib/db/migrations.ts`, run sequentially on app startup:

| # | Description |
|---|---|
| 0 | Initial: `stories`, `acts`, `messages`, `act_line_meta`, `act_lines`, `act_line_premises`, `story_folders`, `app_state` + indexes |
| 1 | `ALTER TABLE messages ADD COLUMN scene_plot TEXT` |
| 2 | `ALTER TABLE messages ADD COLUMN important_phrases TEXT` |

### Message Types

The `Message` type (`src/lib/db/messages.ts`) is the canonical DB representation:

```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  metadata?: string;
  sceneNumber?: number;
  actSummary?: string;
  scenePlot?: string;
  importantPhrases?: string;     // newline-separated string in DB
  variables?: NarrativeVariables; // JSON-serialized in DB
  createdAt: number;
}
```

`MessageRow` maps the snake_case DB columns to camelCase. `mapRowToMessage(row)` converts `MessageRow → Message`. Key helpers:

- `parseImportantPhrases(raw)` — splits on `\n`, returns `string[] | undefined`
- `serializeImportantPhrases(phrases)` — joins with `\n`
- `parseVariables(raw)` — JSON parse + `FIELD_DESCRIPTORS` field mapping
- `updateMessageFields(id, fields)` — partial update for `actSummary`, `scenePlot`, `importantPhrases`

### Act Line Architecture

Act lines model branching narratives. Each act has one or more act lines (the main line plus any branches).

**Tables:**

- `act_line_meta` — metadata (id, actId, name, isMainLine)
- `act_lines` — junction table (act_line_id, message_id, sequence) linking messages to act lines
- `act_line_premises` — interview transcript messages (same structure, predates act line messages)
- `acts` — act records with `continues_from_act_line_id` for cross-act branching

**Key operations** (`src/lib/db/act-lines.ts`):

- `getMessagesForLine()` / `getPremisesMessages()` — retrieve messages via JOIN (both use `mapRowToMessage`)
- `branchFromLine(newLineId, fromLineId, fromSequence, actId, name)` — copies entries up to `fromSequence` + premises
- `batchResolveActLineInfo(items)` — batch-resolves act numbers, max sequences, and per-message sequences
- `getPreviousActSummary(actLineId)` — fetches last act_summary from the previous act's main line (via `continues_from_act_line_id` chain)
- `removeOrphanedMessages()` — garbage-collects messages no longer referenced by any act line or premises

**Shared message safety**: `removeMessagesFromActLine()` only deletes `messages` rows when no other act line references them (prevents data loss on forked lines).

## Settings Architecture

**`src/lib/stores/settings.svelte.ts`** — Svelte 5 `$state` rune persisted to `localStorage`.

### Provider Configs

Multi-provider setup with role-based assignment:

```typescript
interface ProviderConfig {
  id: string;
  name: string;
  provider: 'openai' | 'openai-compatible' | 'ollama';
  apiType: 'chat-completions' | 'responses';
  baseURL: string;
  model: string;
  apiKey: string;
}

interface Settings {
  providers: ProviderConfig[];
  roleAssignments: Record<string, string>;  // role name → provider config id
  // Per-role provider role strings (resolved via roleAssignments)
  plotPlannerProviderRole: string;
  writerProviderRole: string;
  reviewerProviderRole: string;
  editorProviderRole: string;
  gameMasterProviderRole: string;
  summarizerProviderRole: string;
  memoryProviderRole: string;
  embeddingProviderRole: string;
  minorTaskAgentProviderRole: string;
  // Feature toggles
  importantPhraseHighlighting: boolean;  // default: false
  // Other
  logLevel: LogLevel;
  fontSize: number;
  memoryEnabled: boolean;
  targetWordCount: number;  // default: 400
}
```

### Role Resolution

Each role has a `get<X>ProviderConfig()` function following this pattern:

```typescript
function getWriterProviderConfig(): ProviderConfig | undefined {
  const role = settings.writerProviderRole || 'main';
  const id = settings.roleAssignments[role];
  const config = id ? getProviderConfig(id) : getProviderConfig(role);
  if (!config?.apiKey) return undefined;
  return config;
}
```

Roles fall back to `main` if not explicitly configured. The `main` role is the default provider.

### Provider Config CRUD

- `addProviderConfig(partial)` — creates with UUID
- `updateProviderConfig(id, partial)` — updates in-place
- `deleteProviderConfig(id)` — removes + cleans up `roleAssignments`

### Guard Helpers

- `isPhraseHighlightingEnabled()` — returns `settings.importantPhraseHighlighting && !!getMinorTaskAgentProviderConfig()`

### Migration

`migrateFromFlatSettings()` detects old flat shape (`provider: string` without `providers: []`) and converts to multi-provider, assigning the old config to the `main` role.

## Prompt Loading System

The app uses a unified prompt loading system with a `Prompt` class pattern:

### Core Files

- **`src/lib/fs/prompt-loader.ts`**: Contains the `Prompt` class and core loading logic
  - `Prompt` class: Holds `relativePath` and `defaultContent`, with `load()` method
  - `loadPrompt()`: Ensures base file exists in AppData, returns content
  - `loadPromptForStory()`: Loads with story-specific override fallback
  - `ensureAllBaseConfigs()`: Creates all registered prompt files on app startup

- **`src/lib/fs/prompts.ts`**: Unified module exporting all prompt loading functions
  - Declares all prompts as `const Prompt` instances
  - Exports wrapper functions: `loadSystemPrompt()`, `loadWorldTemplate()`, etc.
  - Registers all defaults on module load for `ensureAllBaseConfigs()`

- **`src/lib/fs/prompts/`**: Bundled default markdown files organized by category
  - `system-prompt.md`, `general-instructions.md` at root
  - `world/`: world-template.md, generate-world-from-chat-prompt.md, etc.
  - `act/`: act-card-template.md, act-plot-template.md, act-plot-generation-prompt.md
  - `character/`: character-card-template.md, summarize-characters-in-act.md, etc.
  - `memories/`: memory-extraction-prompt.md, memory-extraction-template.md
  - `reviewer/`: editor-mode-extraction-prompt.md, trigger-editor-mode-fragment.md
  - `editor/`: editor system prompt
  - `writer/`: writer system prompt + output template
  - `game-master/`: game master system prompt
  - `plot-planner/`: plot planner system prompt
  - `summarizer/`: summarizer prompt + incremental prompt + templates
  - `features/`: important-phrases-prompt.md
  - `import/`: import-related prompt templates
  - `interview-extraction-prompt.md`

### AppData Structure

Base prompt templates are stored in `AppData/config/prompt-templates/`:

```
AppData/
  config/
    prompt-templates/
      system-prompt.md
      general-instructions.md
      world/
        world-template.md
        ...
      act/
        act-card-template.md
        ...
      character/
        character-card-template.md
        ...
      memories/
        memory-extraction-prompt.md
        ...
      reviewer/
        editor-mode-extraction-prompt.md
        ...
      features/
        important-phrases-prompt.md
        ...
```

## Story Folders

Each story gets a dedicated folder in AppData containing its own `system-prompt.md`. The global `system-prompt.md` at the AppData root serves as the default template — when a story folder is created, the default prompt is copied into it.

- **Folder naming**: Derived from the story name via `canonicalName()` (strips `/ \ < > : " | ? *` and control chars, supports Unicode). If two stories share the same name, the later one gets a short UUID suffix (e.g., `My Story - a1b2`). If the canonical name is empty (all chars sanitized), `deriveStoryName()` fall backs to `story-{shortId}`.
- **Resolution**: `resolveStoryFolder()` in `src/lib/fs/story-folders.ts` handles folder lookup. It checks the `story_folders` DB table first, then falls back to filesystem scanning. Exact name matches are preferred; UUID suffix is used only on collision.
- **Prompt switching**: When a story is selected, its system prompt is loaded via `loadStorySystemPrompt()` and cached in the stories store. Chat messages use this story-specific prompt.

### Story-Specific Overrides

Each story folder can contain its own `prompt-templates/` subdirectory with story-specific overrides. Resolution order:

1. Story-specific: `<story-folder>/prompt-templates/<relativePath>`
2. Base file: `config/prompt-templates/<relativePath>`
3. Bundled default (in-memory fallback)

## Narrative Generation Pipeline

The core pipeline orchestrates multi-phase narrative generation. **Not to be confused with the Streaming Pipeline** (which handles low-level LLM stream parsing).

### Architecture

**`src/lib/ai/pipeline.ts`** — `runPipeline()` function; **`src/lib/ai/pipeline-types.ts`** — types.

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

Phase details:

1. **Writer** — Streams narrative with `NARRATIVE_DESCRIPTORS` (scene fields + game data)
2. **Reviewer** — Streams review; if `reviewerAcceptsAsIs()`, skips Editor
3. **Editor** — Streams refined prose with `EDITOR_DESCRIPTORS` (scene fields only)
4. **Template Fitter (Editor)** — If editor output lacks template metadata, restructures to match writer template format
5. **Important Phrases Extraction** — After Editor, calls `extractImportantPhrases()` on `narrativeBody` (fire-and-forget, gated by `isPhraseHighlightingEnabled()`)
6. **Game Master + Plot Planner** — Run in parallel via `Promise.all`, sharing same context
7. **Template Fitter (GM)** — If GM output lacks decisions, restructures to match game data template format

Async phases start immediately and resolve after the sequential chain. The `PipelineResult` includes:
- `state: PipelineState` — final pipeline state
- `editorMetadata?: StreamResultMetadata` — Editor phase token usage
- `asyncPhases?: Promise<AsyncPhaseResults>` — Summarizer + Memory results
- `importantPhrasesPromise?: Promise<string[] | null>` — separate promise to avoid race with `asyncPhases`

### Pipeline Types

```typescript
// narrative-types.ts
type PhaseName = 'PLOT_PLANNER' | 'WRITER' | 'REVIEWER' | 'EDITOR' | 'TEMPLATE_FITTER' | 'GAME_MASTER' | 'SUMMARIZER';

interface PipelineProviderConfigs {
  plotPlanner, writer, reviewer, editor, gameMaster, summarizer, minorTaskAgent: ProviderConfig | undefined;
}

interface PipelineCallbacks {
  onPhaseStart, onPhaseStream, onPhaseRetry, onPhaseComplete, onError, onAllComplete;
}
```

### Descriptors System

**`src/lib/ai/descriptors.ts`** — defines which fields each phase extracts from LLM output using `OutputDescriptor[]`. The stream parser (`src/lib/chat-stream-parser/`) uses these to route structured sections into `NarrativeVariables` or `GameDataFields`:

| Descriptor Set | Used By | Extracts |
|---|---|---|
| `SCENE_DESCRIPTORS` | Writer, Editor, Editor Template Fitter | sceneTitle, background, narrativeBody, cg |
| `GAME_DATA_DESCRIPTORS` | GM, GM Template Fitter | activePlotThreads, decisionContext, decisions |
| `NARRATIVE_DESCRIPTORS` | Writer | scene + game data (combined) |
| `REVIEWER_DESCRIPTORS` | Reviewer | (none — raw text) |
| `PLOT_PLANNER_DESCRIPTORS` | Plot Planner | (none — raw text) |

### Chat Stream Parser

**`src/lib/chat-stream-parser/`** — descriptor-based extraction from LLM markdown output:

- `types.ts` — `OutputDescriptor`, match types (`HeaderMatch`, `ListMatch`, `ListItemMatch`, `ListLabeledItemMatch`)
- `parser.ts` — `parseContent(content, descriptors)` dispatches to header/list extractors; uses `marked.lexer()` for tokenization; sets values via lodash `set()` with paths like `'sceneTitle'` or `'activePlotThreads[0]'`

### Narrative Variables

```typescript
// narrative-types.ts
interface NarrativeVariables {
  sceneTitle: string | null;
  background: string | null;
  narrativeBody: string | null;
  cg: string | null;
  gameData: GameDataFields | null;
}

interface GameDataFields {
  activePlotThreads: string[];
  decisionContext: string | null;
  decisions: string[];
}
```

`FIELD_DESCRIPTORS` defines canonical field ordering for serialization/deserialization.

## Chat State Management

**`src/lib/ai/chat.svelte.ts`** — Svelte 5 runes (`$state`) managing the main chat UI.

### UIMessage Type

```typescript
interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  metadata?: MessageMetadata;
  sceneNumber: number;
  variables?: NarrativeVariables;
  phases?: UIScenePhase[];       // non-EDITOR phases shown as accordion
  actSummary?: string;
  scenePlot?: string;
  importantPhrases?: string[];   // parsed from DB string (not raw string)
}
```

`UIMessage.importantPhrases` is `string[]` (array for UI use), while `Message.importantPhrases` is `string` (newline-separated for DB storage). Conversion happens via `parseImportantPhrases()` / `serializeImportantPhrases()`.

### Message Lifecycle

| Function | Purpose |
|---|---|
| `newMessage(role, sceneNumber)` | Creates blank UIMessage with `crypto.randomUUID()` |
| `persistMessage(actLineId, message)` | Writes to `messages` DB + `act_lines` junction table |
| `loadActLineMessages(actLineId)` | Loads messages, maps to UIMessages, triggers backfill if needed |
| `backfillImportantPhrases(msgs, deps)` | Extracts missing phrases for assistant messages with `narrativeBody` |
| `sendMessage(actLineId, message)` | Full pipeline orchestration |

### sendMessage Flow

1. Waits for any `pendingAsyncPhases` from previous run
2. Gets previous narrative variables via `getPreviousNarrativeMessage()`
3. Creates user + assistant messages, adds to `messages` array
4. Builds `PipelineProviderConfigs` — maps 7 roles to provider configs (falls back to `main`)
5. Builds `PipelineCallbacks` for phase accordion, editor content, and final merge
6. Calls `runPipeline()`, handles `importantPhrasesPromise` (fire-and-forget)
7. On error: `handleStreamError()` persists partial content on `AbortError`, otherwise removes message

## Dialogue Preprocessor

**`src/lib/utils/dialogue-preprocessor.ts`** — `preprocessDialogue(content, characterNames?, importantPhrases?)` applies highlighting with strict precedence rules.

### 7-Step Pipeline

1. **Mask HTML block regions** — Nesting-aware state machine for `HTML_BLOCK_TAGS` (div, header, aside, section, article, main, footer, nav, blockquote, pre, table). Whole regions masked as units.
2. **Mask inline HTML tags** — `/<[^>]+>/g`
3. **Wrap dialogue quotes** — `"([^"\\]|\\.)*"` → `<span class="dialogue">...</span>`
4. **Mask dialogue spans** — Subsequent passes can't match inside dialogue
5. **Wrap important phrases** — `highlightTerms(result, phrases, 'highlighted-phrase', mask, false)` — no word boundaries (exact substring match)
6. **Wrap character names** — `highlightTerms(result, names, 'character-name', mask)` — word boundary enforcement
7. **Restore all masks** — Unmask in reverse order

**Precedence**: dialogue > highlighted-phrase > character-name

Masking uses `\x00<CLASS>_MASK_<index>\x00` placeholders.

## Important Phrase Highlighting

Background LLM extraction + UI highlighting of key narrative phrases.

### Extraction

**`src/lib/ai/important-phrases-extractor.ts`** — `extractImportantPhrases(narrativeBody: string): Promise<string[]>`

- Uses MinorTaskAgent provider (`getMinorTaskAgentProviderConfig()`)
- System prompt: `features/important-phrases-prompt.md`
- Retries: `RETRY_COUNT=2`, `BACKOFF_MS=2000`, skips on auth errors
- Parses response: split by newline, trim, filter empty, limit to `MAX_PHRASES=5`
- On failure: logs error, returns `[]` (non-blocking)

### Integration Points

- **Pipeline**: After Editor phase, starts extraction as `importantPhrasesPromise` (fire-and-forget). Gated by `isPhraseHighlightingEnabled()`.
- **Chat**: On `sendMessage()` completion, resolves promise → persists via `updateMessageFields()` → updates `UIMessage` in place
- **Backfill**: On `loadActLineMessages()`, iterates assistant messages missing `importantPhrases` and extracts sequentially
- **Rendering**: `MarkdownContent.svelte` passes `importantPhrases` to `preprocessDialogue()`

### Feature Gate

Enabled only when `settings.importantPhraseHighlighting === true` AND `getMinorTaskAgentProviderConfig()` returns a valid config. Check via `isPhraseHighlightingEnabled()`.

## Template Rendering

**`src/lib/ai/template-renderer.ts`** — renders `NarrativeVariables` into the story message template.

- `renderFromVariables(variables, template, extraReplacements?)` — renders if `hasTemplateMetadata()` (has `sceneTitle`), otherwise returns empty string
- `renderTemplate(template, variables, extraReplacements?)` — single-pass `{placeholder}` replacement; arrays become bullet lists
- `variablesToMarkdown(variables)` — serializes back to markdown for LLM history
- `gameDataToMarkdown(gameData)` — serializes `GameDataFields`
- `hasTemplateMetadata(variables)` — checks for `sceneTitle` field

**`src/lib/fs/view-templates.ts`** — loads view templates (story-message-template.md) with story-specific override support.

## Act Summary System

**`src/lib/ai/act-summary-parser.ts`** — parses and merges structured act summaries.

### Types

```typescript
interface ActSummary {
  completedScenes: number;
  scenes: SceneSummary[];
  characters: CharacterSummary[];
}
interface IncrementalUpdate {
  completedScenes?: number;
  newScene?: SceneSummary;
  characterUpdates?: CharacterSummary[];
}
```

### Key Functions

- `parseActSummary(text)` — parses full markdown via `marked.lexer()`, extracts Progress, Scene Summaries, Character Summaries
- `parseIncrementalOutput(text)` — parses incremental LLM output
- `serializeActSummary(summary)` — converts back to markdown
- `mergeActSummary(existing, incremental)` — merges incremental into existing: `completedScenes` overridden, new scene appended, characters matched by name with alias union and scene entry append
- `parseCharacterAliases(text)` — parses `### [Name]` + `- Aliases: [...]` format

The pipeline uses incremental summaries when an existing `actSummary` exists (faster), otherwise generates a full summary.

## Act Plot System

**`src/lib/ai/act-plot-generator.ts`** — generates `act-plot.md` using a Writer → Reviewer → Editor pipeline (same pattern as the main pipeline but simpler).

- Uses world content, previous act summary, and interview transcript (`act_line_premises`) as context
- Writes to `{lineDir}/act-plot.md`
- Triggered by `ensureActPlot()` in `stories.svelte.ts` when an act line is selected and no act-plot file exists

### Read-Act-Plot Tool

**`src/lib/ai/tools/read-act-plot.ts`** — `createReadActPlotTool()` gives the LLM access to the current act plot during chat.

## AI Tools

**`src/lib/ai/tools/tools.ts`** — `buildTools(storyId, actLineId)` combines all tool sets:

| Tool | File | Purpose |
|---|---|---|
| `query-memories` | `query-memories.ts` | Semantic search over character memories and locations |
| `query-inventory` | `query-inventory.ts` | Search and modify inventory items |
| `evaluate-risk` | `evaluate-risk.ts` | Dice-roll risk evaluation (-1/0/1 outcome) |
| `read-act-plot` | `read-act-plot.ts` | Read the current act plot file |
| `read-scene` | `read-scene.ts` | Read messages for a specific scene number |

### Risk Model

**`src/lib/ai/risk-model.ts`** — `evaluateRisk(riskLevel, random)`: maps risk level 1–10 to outcome probabilities. Higher risk → higher chance of bad outcome (-1). Neutral (0) and good (1) outcomes are also possible.

## Memory System

The app maintains a vector-based memory database for each story, enabling the AI to recall past events, locations, and character interactions during chat.

### Architecture

- **`src/lib/memory/memory.ts`**: `Memory` class managing vector storage and search
  - Stores memories as embeddings in `vec_memories` virtual table (sqlite-vec)
  - Stores locations in `vec_locations` virtual table
  - Methods: `add()`, `search()`, `searchByLocation()`, `searchLocations()`, `sampleByLocation()`
  - Deduplication via cosine distance threshold (0.1)
  - Model compatibility verification with challenge mechanism

- **`src/lib/db/memory-database.ts`**: Separate SQLite connection for memory data
- **`src/lib/db/memory-migrations.ts`**: Memory schema migrations

### Memory Extraction Pipeline

Memories are extracted from assistant messages during chat streaming:

- **`src/lib/ai/memory-extraction-pipeline.ts`**: Orchestrates extraction
  - Triggers on streaming completion when memory is enabled
  - Uses `memory-extraction-prompt.md` and `memory-extraction-template.md`
  - Parses extracted memories and locations via `memory-extract-parser.ts`
  - Writes to memory database with embeddings

- **`src/lib/memory/memory-extract-parser.ts`**: Parses markdown extraction output
  - Extracts character canonical names and their memories
  - Extracts location descriptions
  - Groups memories by character for batch insertion

### Query-Memories Tool

The AI can query memories during chat via a tool:

- **`src/lib/ai/tools/query-memories.ts`**: `createQueryMemoriesTool()` factory
  - Parameters: `characterQuery` (string), `timeAndLocation` (string), `currentActOnly` (boolean)
  - Three search modes:
    1. `characterQuery + timeAndLocation` → `searchByLocation()` (filtered by location)
    2. `characterQuery` only → `search()` (sorted by relevance, sliced to limit)
    3. `timeAndLocation` only → `searchLocations()` + `sampleByLocation()` + `sampleSize()` (random sampling)
  - Returns memories with `actNumber`, `messagesAgo`, `location`, and content

### Memory Regeneration

Users can regenerate memories for an act line:

- **`src/lib/stores/memory-regeneration.svelte.ts`**: State management
- **`src/routes/memory-manager/+page.svelte`**: UI for memory management

## Editor Mode Reviewer

The app includes an optional AI reviewer that validates assistant responses:

- **`src/lib/reviewer/review-loop.ts`**: Orchestrates review cycles
  - Streams review using `editor-mode-extraction-prompt.md`
  - Parses review scratchpad for flags and fixes
  - Applies fixes to content if issues found
  - Maximum 3 review cycles per message

- **Trigger**: Enabled via `settings.editorModeEnabled` — adds `trigger-editor-mode-fragment.md` to system prompt

## World Builder

The world builder is an AI-guided interview that creates a story's world document. It runs in a separate mode within the main page (`+page.svelte`), toggled by `getIsWorldBuilderActive()`.

- **State**: `src/lib/ai/world-builder.svelte.ts` — Svelte 5 runes with `$state()`. Tracks messages, streaming state, completion status, and log file path.
- **Shared streaming**: Uses `streamChatResponse()` from `chat-stream.ts` — same full parser chain as main chat. The world builder's state callback only reads `state.content` and ignores `gameData`/`reasoning`, but parsing still runs.
- **Completion marker**: The AI emits `[WORLD_BUILDER_COMPLETE]` followed by the story name and Markdown world document. `extractCompletionData()` parses this into `{ storyName, worldContent }`.
- **Story creation**: `createStoryFromWorldBuilder()` in `stories.svelte.ts` creates the story, act, act line, writes `world.md`, moves the temp log, then selects the new story.
- **Logging**: World builder logs are written to `AppData/logs/worldbuilding-{yyyyMMddHHmmss}.log` during the session. After story creation, `moveWorldBuilderLog()` moves the log into the story folder.
- **Chat actions**: Copy, regenerate, and delete work the same as the main chat. `regenerateLastWorldBuilderResponse()` removes the last assistant message and calls `streamNextResponse()`. `deleteLastWorldBuilderExchange()` removes the last user+assistant pair.

## Import World

The app can import existing chat transcripts as new stories:

- **`src/routes/import-world/+page.svelte`**: Import UI
- **`src/lib/import-world/import-orchestrator.ts`**: Main orchestration
  - Parses transcript files (JSON, Markdown, generic text)
  - Detects game data (world state, decisions)
  - Generates acts from extracted content
  - Creates story structure with acts and act lines

- **`src/lib/import-world/transcript-parsers.ts`**: Multi-format parsing
- **`src/lib/import-world/game-data-detector.ts`**: Detects structured game data
- **`src/lib/import-world/act-generator.ts`**: Generates acts from parsed content

## Streaming Pipeline

The AI streaming pipeline is a layered architecture for processing LLM responses:

```
executeStream (streaming.ts)
  → StreamCallbacks { onTextDelta, onReasoningDelta?, onComplete, onError }
    → createStreamAccumulator (chat-callbacks.ts)
      → createParserChain (parser-chain.ts)
        → ThinkingTagParser → GameDataStreamParser
      → message-updater helpers (applyParserOutput, applyReasoningDelta)
```

- **`streaming.ts`**: Low-level `executeStream()` wraps the Vercel AI SDK `streamText()`. Uses `ToolSet` type and `stopWhen: stepCountIs(DEFAULT_MAX_STEPS)` for tool loops. Emits callbacks, returns void — lifecycle is callback-driven.
- **`chat-callbacks.ts`**: `createStreamAccumulator()` wires the parser chain into `StreamCallbacks`. Accumulates immutable `StreamState` (`content`, `reasoning`, `gameData`). Exposes `resultMetadata` as a `Promise` resolved on `onComplete`.
- **`parser-chain.ts`**: Chains thinking-tag parser then game-data parser. `feed()` returns `ParserChainOutput` (`text`, `thinking`, `gameData`). `flush()` drains buffered state.
- **`thinking-tag-parser.ts`**: Character-by-character state machine that extracts `think`-tag blocks. Separates reasoning content from visible text.
- **`message-updater.ts`**: Pure immutable helpers for `StreamState` updates: `applyParserOutput`, `applyReasoningDelta`. Private `isValidGameData()` validates game data before applying.
- **`chat-stream.ts`**: Shared library function `streamChatResponse()` — creates model, accumulator, calls `executeStream`, returns `MessageMetadata`. Used by both `chat.svelte.ts` and `world-builder.svelte.ts`. Includes `streamWithRetry()` with exponential backoff.

## Thinking Tags

Some AI models emit reasoning enclosed in `think` tags. The `ThinkingTagParser` (character-by-character state machine) extracts these during streaming and separates them from visible content.

- **Parser**: `src/lib/ai/thinking-tag-parser.ts` — states: TEXT → POTENTIAL_OPENER → THINKING_BODY → POTENTIAL_CLOSER. Uses `THINK_TAG_NAME` constant.
- **Integration**: Wired via `parser-chain.ts` before the game-data parser.

## Game Data Blocks

During main chat streaming, ```json blocks containing `worldState`(string) and`decisions` (string[]) are intercepted and hidden from chat content.

- **Parser**: `src/lib/ai/game-data-parser.ts` — character-by-character state machine (TEXT → POTENTIAL_OPENER → JSON_BODY → POTENTIAL_CLOSER) that buffers during streaming.
- **Validation**: Private `isValidGameData()` in `message-updater.ts` — skips game data with blank `worldState` or empty `decisions` array.
- **Rendering**: Decisions are rendered as clickable buttons below messages. Game data shows in a collapsed accordion on the assistant message card. Buttons are limited to 2 lines via `line-clamp`.
- **History injection**: `toHistoryMessage()` in `chat.svelte.ts` appends game data JSON to message content when building LLM history, so the model sees prior game state.
- **Persistence**: `game_data` column in `messages` table (migration 4). Canonical types: `GameData` interface and `parseGameData()` in `src/lib/db/messages.ts`.

## Character and Act Card Generation

The app can generate character cards and act summaries from chat transcripts:

- **Character Cards** (`src/lib/ai/character-card-generator.ts`): Extracts characters from an act line, generates individual character cards with personality, appearance, and arc information. Uses lineage tracking to include previous act card context.
- **Act Cards** (`src/lib/ai/act-card-generator.ts`): Generates summary documents for entire acts from the chat transcript.

Both generators:

- Use `Prompt` class instances from `$lib/fs/prompts` for template loading
- Support parallel generation for multiple characters
- Write output to story folder under `act-N/characters/` subdirectories

## Scroll Behavior

Auto-scroll uses two observers on `chatContainer` (shared by main chat and world builder):

- **IntersectionObserver**: Watches the streaming cursor span (`streamingCursor` for main chat, `wbStreamingCursor` for world builder). If visible, `stuckToBottom = true`.
- **MutationObserver**: Fires on every DOM mutation. Scrolls to bottom when `stuckToBottom` is true.
- User can "detach" by scrolling up (cursor leaves viewport). Sending a message or clicking a decision forces `stuckToBottom = true`.

## Text Size Controls

The UI supports dynamic typography scaling via a sidebar slider and keyboard shortcuts:

- **Slider**: Range input in `+layout.svelte` sidebar footer, range 0.7–1.5, step 0.05. Persisted in `settings.fontSize`.
- **Ctrl+Scroll**: Holding Ctrl and scrolling adjusts font size by ±0.05 increments, clamped to 0.7–1.5 via lodash `clamp`.
- **Rendering**: `MarkdownContent.svelte` applies the scale factor to its content container.

## Vector Data Types (sqlite-vec)

The app has the `sqlite-vec` extension available in all SQLite connections. This enables vector storage and similarity search directly in the database, accessible from the frontend via `tauri-plugin-sql` JavaScript API.

### How It Works

- **Registration**: `main.rs` calls `sqlite3_auto_extension()` with `sqlite3_vec_init` before `app_lib::run()`. This registers the extension process-globally on the bundled SQLite library.
- **Propagation**: `tauri-plugin-sql` (via sqlx) links against the same bundled `libsqlite3-sys`. Since the bundled build produces a single static library, the auto-extension affects all connections — no Rust Tauri commands needed.
- **Usage**: All sqlite-vec SQL functions (`vec_version`, `vec_distance_cosine`, `vec_to_json`, etc.) and the `vec0` virtual table module are available from JavaScript SQL queries.

### Constraints

- **vec0 schema requires explicit dimension**: `float[N]` (e.g., `float[768]`), not bare `float`.
- **Vectors as JSON strings**: `tauri-plugin-sql` IPC cannot bind binary BLOBs from JavaScript. Pass vectors as JSON strings (e.g., `'[1.0, 0.5, 0.33]'`) — sqlite-vec parses them natively.
- **Integer primary keys only**: JS `number` values bind as REAL through IPC. Use `last_insert_rowid()` in SQL instead of passing rowids from JavaScript to keep them as native SQLite integers.
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

### Online References for sqlite-vec

　— API Reference:　https://alexgarcia.xyz/sqlite-vec/api-reference.html
　— vec0 virtual tables:　https://alexgarcia.xyz/sqlite-vec/features/vec0.html

## Utility Functions

### Error Handling (`src/lib/utils/error-handling.ts`)

- `getErrorMessage(err: unknown): string` — narrows `AISDKError`, `APICallError`, standard `Error`

### Async Utilities (`src/lib/utils/async.ts`)

- `withRetry<T>(fn, options)` — exponential backoff retry with `shouldRetry`/`onRetry` hooks
- `isAuthError(error)` — checks 401/403/unauthorized/forbidden
- `isAbortError(error)` — checks `DOMException` `AbortError`
- `sleepOrAbort(ms, signal)` — sleep that rejects on abort signal

## IntelliJ MCP Usage

When using IntelliJ MCP tools, first check whether the current shell is WSL2 by running `which wslpath`.

If `wslpath` is available, convert the project path to a Windows path before passing it to IntelliJ MCP:

```bash
$(wslpath -w "$ProjectPath")
```

where `$ProjectPath` is the current project directory.
