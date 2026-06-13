# Import World Feature

> **Last updated:** 2026-06-13 | **Version:** 0.5.0

Import existing stories from world-building documents, chat transcripts, and character cards into the app's narrative database. Supports multiple transcript formats, extracts structured narrative variables via the Template Fitter pipeline phase, and produces a preview before committing to the database.

---

## Architecture Overview

```
 +page.svelte
      │
      ▼
 import-state.svelte.ts          Form + UI state (Svelte 5 runes)
      │
      ▼
 validators.ts                   Validate form before processing
      │
      ▼
 import-orchestrator.ts          Two-phase coordinator
      ├──── transcript-parsers.ts      Parse JSON → ParsedMessage[]
      ├──── narrative-filler.ts        Extract NarrativeVariables via LLM
      │      └── pipeline-context.ts   Build PipelineRunContext for import
      │             └── ← $lib/ai/pipeline/runners.ts (runEditorTemplateFitter)
      └──── world-generator.ts        Generate world.md from cards (no world file)
```

---

## Two-Phase Import Flow

The import is split into **prepare** and **confirm** so the user can review and edit before data is written to the database.

### Phase 1 — `prepareImport(formData, onProgress) → ImportPreviewData | null`

1. Create story in DB, resolve story folder on disk
2. Save `world.md` (if provided); otherwise generate from act/character cards via `generateWorldFromCards()`
3. Load character card files → extract names via `parseContent()` → save to `characters/{kebab-name}.md`
4. Read and save act card files to `act-{N}/act-card.md`
5. For each act:
   - Create Act + ActLine in DB
   - If transcript provided: parse via `transcript-parsers.ts` → run `narrative-filler.ts` on messages missing `sceneTitle`
   - Build `ImportPreviewMessage[]` with `id` and `removed` flag
6. Return `ImportPreviewData` (includes `createdResources` for rollback on failure)

On any error, `cleanupImport()` deletes all created resources in reverse order.

### Phase 2 — `confirmImport(preview, onProgress) → ImportResult`

1. Filter out `system` messages and messages marked `removed`
2. Assign scene numbers via `assignSceneNumbers()`
3. Create DB message records + link to act lines with sequence numbers
4. Determine `needsInterview`: true when the last act has no visible messages (i.e., user only provided cards, no transcript — the World Builder interview should run)
5. Return `ImportResult` with `needsInterview`, `worldContent`, and `interviewContext`

If `needsInterview`, the UI navigates to the main chat in World Builder interview mode.

### Cancel — `cancelImport(preview)`

Calls `cleanupImport()` to roll back everything created in Phase 1.

---

## Core Modules

### `types.ts`

Canonical type definitions imported by every other module in the feature.

| Type                                                         | Purpose                                                                                                                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TranscriptFormat`                                           | `'app-export' \| 'openai-api' \| 'openwebui' \| 'unknown'`                                                                                                           |
| `ImportFormData`                                             | Top-level form state: story name, world file, acts, characters, retry config                                                                                         |
| `ImportActInput`                                             | Single act: `id`, `name`, `actFile` (.md/.txt), `transcript` (.json)                                                                                                 |
| `ImportCharacterInput`                                       | Character: `id`, `name`, `cardFile` (.md/.txt)                                                                                                                       |
| `ParsedTranscript`                                           | Result of parsing: `{ format, messages: ParsedMessage[] }`                                                                                                           |
| `ParsedMessage`                                              | Unified message: `role`, `content`, `reasoning?`, `metadata?`, `variables?` (NarrativeVariables)                                                                     |
| `NarrativeExtractionResult`                                  | Template Fitter result per message: `messageIndex`, `variables`, `source`                                                                                            |
| `ImportPreviewMessage`                                       | Preview table row: extends ParsedMessage with `id` and `removed`                                                                                                     |
| `ImportPreviewAct`                                           | Preview act: `actId`, `actLineId`, `actName`, `actNumber`, messages                                                                                                  |
| `ImportPreviewData`                                          | Full preview: story info, acts, cards, `createdResources`                                                                                                            |
| `CreatedResources`                                           | Tracks all created DB IDs for rollback: `storyId?`, `storyFolder?`, `actIds[]`, `actLineIds[]`, `messageIds[]`                                                       |
| `ImportResult`                                               | Final outcome: `success`, `storyId`, act IDs, `needsInterview`, `worldContent`, `interviewContext`                                                                   |
| `ImportProgressUpdate`                                       | Progress event: `phase`, `message`, `errorMessage?`, `consoleOutput?`                                                                                                |
| `ImportPhase`                                                | `'validating' \| 'creating-story' \| 'processing-act' \| 'generating-world' \| 'generating-game-data' \| 'saving-messages' \| 'finalizing' \| 'complete' \| 'error'` |
| `ValidationResult` / `ValidationError` / `ValidationWarning` | Validation output with field-level errors and warnings                                                                                                               |

### `transcript-parsers.ts`

Parses uploaded JSON files into `ParsedMessage[]`. Auto-detects format and delegates:

| Format         | Detection signal                                                 | Notes                                                                         |
| -------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **App Export** | `messages[]` with `metadata`, `game_data`, or `reasoning` fields | Native format; preserves game data as `GameDataFields`                        |
| **OpenAI API** | `messages[]` with simple `role`/`content` only                   | Supports `reasoning` and `reasoning_content`                                  |
| **Open WebUI** | Array with `chat.history.messages` tree                          | DFS with cycle detection, extracts `output[]` arrays into content + reasoning |

**Entry point:** `parseTranscriptFile(file, skipOptionalMalformed)`

Key internals:

- `detectTranscriptFormat(json)` — inspects structure to identify format
- `parseAppExportFormat()` — preserves `game_data` → `GameDataFields`, `metadata`, `reasoning`
- `parseSimpleOpenAIFormat()` — basic role/content with optional reasoning
- `parseOpenWebUIFormat()` — tree traversal (`buildSequence()`) to find longest message chain; `convertOpenWebUIMessage()` separates content from reasoning in `output[]`
- `parseGameData(raw, skipOptionalMalformed)` — safely JSON-parses `game_data` string, falls back to `null` on failure when `skipOptionalMalformed` is true

### `validators.ts`

`validateImportForm(formData) → ValidationResult`

Validation rules:

- All acts except the last **must** have a transcript (blocking error)
- The last act must have a transcript OR act file OR world file OR character cards (blocking error)
- Empty story name → warning (auto-generated if missing)
- Empty act names → warning
- Missing character card files → warning
- Missing character names → warning (derived from card content)
- File type validation: act/character files must be `.md`/`.txt`, transcripts must be `.json`
- File size limit: 50 MB per file (`MAX_FILE_SIZE`)
- `retryCount` must be in `[0, 20]`; `backoffIntervalSeconds` in `[1, 60]`
- At least one piece of content must be provided (world file, acts, or characters)

### `narrative-filler.ts`

Runs the **Template Fitter** pipeline phase against assistant messages that lack structured `NarrativeVariables` (specifically, messages missing `sceneTitle`). This enriches raw imported text with scene title, background, narrative body, etc. — extracting structure from unstructured transcripts via LLM.

**Entry point:** `runNarrativeFilling(messages, retryConfig, log, onProgress, onError)`

Flow:

1. Scan for assistant messages where `editorHasTemplateMetadata(message.variables)` is false
2. For each, sequentially:
   - Build `PipelineRunContext` via `buildImportRunContext()` with `writerOutputTemplate`
   - Run `runEditorTemplateFitter(ctx, state, trackPhase)` — the same `TEMPLATE_FITTER` phase used in the main narrative pipeline
   - If fitter produces `narrativeBody`, mark `source: 'template-fitter'`; otherwise wrap raw content in `emptyVariables()` with `source: 'none'`
   - 100 ms delay between messages (rate limiting)

This is the key integration point where import-world **reuses the pipeline infrastructure** rather than implementing its own LLM extraction.

### `pipeline-context.ts`

Builds a `PipelineRunContext` suitable for import-world operations. This is the bridge between the import feature and the narrative generation pipeline — it provides the pipeline with the context it needs without requiring a real story/act/assistant setup.

| Export                                                                | Purpose                                                                                                                                         |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `EMPTY_PRE_EDITOR_CONTEXT`                                            | A `PreEditorContext` with all fields empty/zeroed — used when importing has no prior story state                                                |
| `buildImportRunContext(retryConfig, abortSignal, callbacks, prompts)` | Constructs a full `PipelineRunContext` using empty story/assistant contexts, `buildPipelineProviderConfigs()`, and any partial prompt overrides |

The `prompts` parameter is a `Partial<PipelineRunContext['prompts']>`, so callers only need to provide the specific prompt overrides (e.g., `writerOutputTemplate` for narrative filling). All other prompt fields default to empty strings.

**Used by:**

- `narrative-filler.ts` — to run the Template Fitter on parsed messages
- `chat.svelte.ts` `regenerateGameData()` — to re-run the GM phase for an existing message outside a full pipeline run

### `import-orchestrator.ts`

Main coordinator. See [Two-Phase Import Flow](#two-phase-import-flow) above for the overall flow. Key internal helpers:

| Function                     | Purpose                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `prepareActs()`              | Iterate acts, create Act + ActLine, parse transcript, run narrative filling                                 |
| `createActAndLine()`         | Create Act and main ActLine in DB, track created IDs                                                        |
| `enrichTranscriptAct()`      | Parse transcript file, detect missing `sceneTitle`, call `runNarrativeFilling()`, merge results back        |
| `regenerateWorldFromCards()` | Generate `world.md` via `generateWorldFromCards()` when no world file was provided                          |
| `readAndSaveActCards()`      | Read act card files and save to `act-{N}/act-card.md`                                                       |
| `loadCharacterCards()`       | Read character card files, extract names via `parseContent()`                                               |
| `saveCharacterCards()`       | Write cards to `characters/{kebab-name}.md` with collision handling                                         |
| `createMessagesFromParsed()` | Create DB message records + link to act line with sequence numbers                                          |
| `assignSceneNumbers()`       | Assign scene numbers: increments after each user message that has a following assistant message             |
| `extractCharacterName()`     | Uses `parseContent()` to extract name from "Core Identity" section of character card                        |
| `cleanupImport()`            | Rollback: delete messages → line entries → act lines → acts → story folder → story (reverse creation order) |

---

## Connection to the Narrative Pipeline

The import-world feature reuses the pipeline's `runEditorTemplateFitter` from `runners.ts` to extract structured narrative variables from raw text. This avoids duplicating LLM extraction logic.

```
import-world                      pipeline
────────────                      ────────
narrative-filler.ts
  └── buildImportRunContext()
        ├── EMPTY_PRE_EDITOR_CONTEXT    ←   types.ts (PreEditorContext)
        ├── buildPipelineProviderConfigs()  ←   chat/pipeline-config.ts
        └── PipelineRunContext           ←   runners.ts
              │
  └── runEditorTemplateFitter()         ←   runners.ts
        └── executeStreamingPhase()      ←   phase-executor.ts
              └── streamWithRetry()      ←   chat-stream.ts
```

The `buildImportRunContext()` function creates an "empty" run context with:

- `preEditorCtx`: All fields zeroed (no world content, no act plot, no previous narrative)
- `story` / `assistant`: Empty IDs (no real story or message sequence)
- `prompts`: All empty strings except for the specific overrides passed by the caller
- `effectiveTargetWordCount`: `'400'` (default)
- `currentScene`: `'1'` (default)

This allows single pipeline phases to be executed in isolation without a full story session.

---

## UI Layer

### `+page.svelte` (`src/routes/import-world/`)

Import World page. Three-step flow:

1. **Form phase** — user fills in story name, world file, acts (with transcript + act card), characters, retry settings
2. **Preview phase** — after `prepareImport()`, shows `ImportPreviewTable` with expandable acts, scene numbers, message excerpts; user can remove/restore individual messages
3. **Saving phase** — after `confirmImport()`, shows completion or error

Key handlers:

- `handleImport()` → validate form → `prepareImport()` → show preview or error
- `handleConfirmImport()` → `confirmImport()` → if `needsInterview`, navigate to chat with World Builder interview mode
- `handleCancelImport()` → `cancelImport()` → clear preview

### `import-state.svelte.ts` (`src/routes/import-world/`)

Svelte 5 runes-based state management. Form state (`storyName`, `worldFile`, `acts[]`, `characters[]`, `skipOptionalMalformed`, `retryCount`, `backoffIntervalSeconds`) and UI state (`isImporting`, `importComplete`, `progressUpdates[]`, `importPhase`, `previewData`). Exposed via `getImportWorldStore()`.

`addProgressUpdate()` includes deduplication: consecutive updates with the same phase + message increment a `repeatedMessageCounter` instead of appending new entries. Console output is capped at 50 lines.

### `ImportPreviewTable.svelte` (`src/routes/import-world/`)

Renders expandable/collapsible acts using Skeleton Accordion. Computes scene numbers (same `assignSceneNumbers()` algorithm), shows scene titles, truncated excerpts, role badges, and remove/restore toggles per message.

---

## Data Flow Example

**Scenario: Import with an OpenAI API transcript and character cards (no world file)**

```
User fills form:
  Story: "My Adventure"
  World file: (none)
  Act 1: transcript.json (OpenAI API format), act-1.md
  Character: alice.md

1. validateImportForm()
   → isValid: true, warnings: [story name empty → auto-generated]

2. prepareImport()
   → Create story "My Adventure" (uuid: abc123)
   → Resolve story folder → "My-Adventure-abc123"
   → No world file → generate from act card + alice.md via generateWorldFromCards()
   → Load alice.md → extractCharacterName() → "Alice"
   → Save characters/alice.md
   → Save act-1/act-card.md
   → Create Act + ActLine
   → Parse transcript.json → 30 messages (openai-api format)
   → 15 assistant messages lack sceneTitle
   → runNarrativeFilling() → runEditorTemplateFitter() × 15
   → Merge extracted variables back into messages
   → Return ImportPreviewData

3. User reviews preview table, removes 2 messages

4. confirmImport()
   → Save 28 messages to DB with scene numbers
   → needsInterview: false (last act has messages)
   → Return ImportResult { success: true }
   → Refresh sidebar
```

---

## Progress Phases

| Phase                  | When                                                |
| ---------------------- | --------------------------------------------------- |
| `validating`           | Before import starts                                |
| `creating-story`       | Creating story, folder, world file, character cards |
| `processing-act`       | Parsing transcript, running narrative filler        |
| `generating-world`     | Generating world.md from cards                      |
| `generating-game-data` | Reserved for future GM phase during import          |
| `saving-messages`      | Persisting messages to DB                           |
| `finalizing`           | Post-import cleanup                                 |
| `complete`             | Import finished successfully                        |
| `error`                | Import failed (with `errorMessage`)                 |

---

## Error Handling

| Error                     | Handling                                                            |
| ------------------------- | ------------------------------------------------------------------- |
| Validation errors         | Shown in UI before processing starts                                |
| Invalid JSON              | Throw `"File is not valid JSON"`                                    |
| Unknown transcript format | Throw `"Unable to detect transcript format"`                        |
| Malformed `game_data`     | Skipped when `skipOptionalMalformed` is true; throws otherwise      |
| Malformed `metadata`      | Same as `game_data`                                                 |
| File too large            | Reject with size limit message (50 MB)                              |
| LLM retry exhaustion      | Warning logged; per-message failure recorded                        |
| DB failure during import  | `cleanupImport()` rolls back all created resources in reverse order |
| Any Phase 1 failure       | `cleanupImport()` + error progress event + return `null`            |
| Any Phase 2 failure       | `cleanupImport()` + `ImportResult { success: false }`               |

`cleanupImport()` iterates in reverse creation order: messages → line entries → act lines → acts → story folder → story. Individual deletion failures are logged as warnings rather than aborting the remaining cleanup.

---

## File Layout on Disk

After import, a story folder contains:

```
stories/{StoryName-uuid}/
  world.md                        ← World document (provided or generated)
  act-1/
    act-card.md                   ← Act card (if provided)
  act-2/
    act-card.md
  characters/
    alice.md                      ← Character cards (kebab-cased names)
    bob-2.md                      ← Collision handling with numeric suffix
```

---

## Testing

Test files in `src/lib/__tests__/import-world/`:

- `transcript-parsers.test.ts` — Covers all 3 formats, edge cases, malformed input
- `validators.test.ts` — Validation rules and boundary conditions

Run tests: `npm test`
