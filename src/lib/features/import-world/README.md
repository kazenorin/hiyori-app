# Import World Feature

The Import World feature allows users to import existing stories from world building documents, transcripts, and character cards. It supports multiple transcript formats, automatically detects game data (decision points), and can generate new content via LLM when no transcript is provided.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Import World Flow                        │
├─────────────────────────────────────────────────────────────┤
│  User Input → Validation → Parse/Generate → Save to DB       │
│                                                              │
│  +page.svelte                                                 │
│       ↓                                                       │
│  import-state.svelte.ts (form state)                          │
│       ↓                                                       │
│  validators.ts (validate form)                                │
│       ↓                                                       │
│  import-orchestrator.ts (coordinate import)                   │
│       ├─→ transcript-parsers.ts (parse JSON formats)         │
│       │      └─→ game-data-detector.ts (extract decisions)   │
│       └─→ act-generator.ts (LLM generation)                   │
│              └─→ prompts.ts (LLM prompts)                    │
└─────────────────────────────────────────────────────────────┘
```

## Core Files

### types.ts

Defines all TypeScript interfaces for the import feature:

- **`ImportFormData`** — Form state with story name, world file, acts array, characters array, settings
- **`ImportActInput`** — Single act with name, act card file, transcript file
- **`ImportCharacterInput`** — Character with name, card file
- **`ParsedTranscript`** — Result of parsing any format with detected format type
- **`ParsedMessage`** — Unified message format (role, content, reasoning, metadata, gameData)
- **`GameData`** — Extracted decision point: `{ worldState: string, decisions: string[] }`
- **`ImportPhase`** — Progress phases: `'validating' | 'creating-story' | 'processing-act' | ...`

### validators.ts

Form validation logic:

- Validates story name, world file, acts, characters
- Enforces business rules:
  - Without world file: each act must have act file or transcript
  - Character sections require card files
  - File type validation (.md, .txt, .json)
  - File size limits (50MB max via `MAX_FILE_SIZE`)
- Returns `{ isValid, errors[], warnings[] }`

### transcript-parsers.ts

Parses three transcript formats into unified `ParsedMessage[]`:

| Format         | Detection                                            | Notes                                  |
| -------------- | ---------------------------------------------------- | -------------------------------------- |
| **App Export** | `{ messages: [...] }` with metadata/game_data fields | Native format with full game data      |
| **OpenAI API** | `{ messages: [...] }` simple role/content            | No metadata, needs game data detection |
| **Open WebUI** | Array with `chat.history.messages`                   | Tree structure, uses longest path      |

**Key functions:**

- `detectTranscriptFormat(json)` — Returns detected format
- `parseAppExportFormat()` — Parses native app format
- `parseSimpleOpenAIFormat()` — Parses basic OpenAI format
- `parseOpenWebUIFormat()` — Builds longest sequence from tree structure
- `parseTranscriptFile(file, skipOptionalMalformed)` — Main entry point

### game-data-detector.ts

Two-pass pipeline to extract `GameData` (decision points) from assistant messages:

**Pass 1: Traditional Extraction** (synchronous)

- Splits content on markdown headers (`#`, `##`, etc.)
- Detects decision keywords: `decision`, `choice`, `option`, `what...do?`
- Extracts:
  - `worldState`: text between header and first list item
  - `decisions`: list items (`*`, `-`, `1.`, `2)`) cleaned of markdown
- Requires at least 2 decisions to be valid

**Pass 2: LLM Extraction** (asynchronous)

- For messages where Pass 1 returned null
- Sends to LLM with `choices-extraction-prompt.md`
- LLM returns JSON: `{ worldState: "...", decisions: ["...", "..."] }`
- Parses JSON from code blocks or raw text
- 100ms rate limit between calls to avoid API throttling
- Updates messages in-place with detected game data

**Entry point:** `runGameDataDetection(messages, retryConfig, choicesExtractionPrompt)`

### act-generator.ts

Generates story content via LLM when no transcript is provided:

**`generateActFromCards()`**

- Builds prompt from world card + act card + character cards
- Uses streaming via `streamChatResponse()` for real-time feedback
- Retries with exponential backoff
- Fast-fails on auth errors (401/403)

**`formatIntoScenes()`**

- Takes raw generated content
- Feeds back to LLM to split into scenes using narration template
- Returns formatted content in proper structure

Prompts are centralized in `prompts.ts`:

- `WORLD_CARD_LABEL` — "The following message is a world building settings card."
- `ACT_CARD_LABEL` — "The following message is an act card..."
- `CHARACTER_CARD_LABEL` — "The following message is a character card for {name}."
- `ACT_GENERATION_INSTRUCTION` — "Generate a story based on the above settings."
- `SCENE_FORMAT_PROMPT` — Multi-line template for scene formatting

### import-orchestrator.ts

Main coordinator. Orchestrates the entire import process:

**`executeImport(formData, onProgress)`**

1. **Create story** — Generate UUID, create in DB, resolve folder, refresh sidebar
2. **Save world file** — Write to `storyFolder/world.md`
3. **Load character cards** — Parse each card file, extract names, validate
4. **Save character cards** — Write to `storyFolder/characters/{kebab-name}.md`
5. **Process acts** — For each act:
   - **Transcript path**: Parse JSON → detect game data → save messages
   - **Generation path**: LLM generate → format scenes → save messages
6. **Finalize** — Refresh sidebar, return success

**Error handling:**

- Tracks all created resources (story, acts, act lines, messages)
- On failure: `cleanupImport()` deletes everything in reverse order
- Logs cleanup warnings for any failures

**Helper functions:**

- `processActs()` — Iterate acts and route to transcript or generation
- `createActAndLine()` — Create act and main act line in DB
- `processTranscriptAct()` — Parse transcript and detect game data
- `generateActFromLLM()` — Generate content via LLM
- `createMessagesFromParsed()` — Save messages to DB with progress updates
- `saveCharacterCards()` — Write character cards with collision handling
- `extractCharacterName()` — Parse name from card content

### prompts.ts

Centralized LLM prompts as constants:

```typescript
WORLD_CARD_LABEL; // Context label for world building card
ACT_CARD_LABEL; // Context label for act card
CHARACTER_CARD_LABEL; // Template with {name} placeholder
ACT_GENERATION_INSTRUCTION; // Final LLM instruction
SCENE_FORMAT_PROMPT; // Multi-line template with placeholders
```

Benefit: All user-facing LLM text in one place for easy review/modification.

## UI Layer

### +page.svelte

Import World page UI:

- Form sections: Story Details, Acts/Chapters, Characters, Import Settings
- File inputs for world file, act files, transcripts (.json), character cards
- Progress panel at top showing current phase and console output
- Import button with validation
- Stays on page after completion (shows success indicator)
- All controls disabled after successful import

### import-state.svelte.ts

Svelte 5 runes-based state management:

- Form state: `storyName`, `worldFile`, `acts[]`, `characters[]`, settings
- UI state: `isImporting`, `importComplete`, `progressUpdates[]`, `consoleOutput`
- Actions: `addAct()`, `removeAct()`, `updateActFile()`, `validate()`, etc.
- Derived: `canSubmit` — only when not importing, not complete, and valid

## Data Flow Example

**Scenario: Import with transcript (OpenAI API format)**

```
User selects:
  - Story name: "My Adventure"
  - World file: world.md
  - Act 1: transcript.json (OpenAI API format)
  - Character: alice.md

1. validateImportForm()
   → isValid: true, warnings: []

2. executeImport()
   → Create story "My Adventure" (uuid: abc123)
   → Save world.md to stories/My-Adventure-abc123/world.md
   → Load alice.md → name: "Alice"
   → Save characters/alice.md

3. processTranscriptAct()
   → Parse transcript.json → 50 messages (openai-api format)
   → Check: 30 assistant messages, 20 lack game data
   → runGameDataDetection()
      Pass 1: 12 messages have decision headers
      Pass 2: LLM extracts 5 more
   → Log: "Game data detection: 17/20 messages processed (5 LLM calls)"

4. createMessagesFromParsed()
   → Save all 50 messages to DB
   → Link to act line

5. Return success
   → Refresh sidebar (new story appears)
   → Stay on page with completion log
```

## Error Handling

| Error Type               | Handling                                           |
| ------------------------ | -------------------------------------------------- |
| Validation errors        | Show in UI before import starts                    |
| File too large           | Reject with size limit message                     |
| Invalid JSON             | Throw with "File is not valid JSON"                |
| Unknown format           | Throw with "Unable to detect transcript format"    |
| LLM auth failure         | Fast-fail with settings message                    |
| LLM retry exhaustion     | Log warning, continue or fail based on context     |
| DB failure during import | `cleanupImport()` rolls back all created resources |

## File Size Limits

All uploaded files are validated against `MAX_FILE_SIZE = 50 * 1024 * 1024` (50MB):

- World files (.md, .txt)
- Act files (.md, .txt)
- Transcripts (.json)
- Character cards (.md, .txt)

## Testing

Test files in `src/lib/__tests__/import-world/`:

- `transcript-parsers.test.ts` — 400+ lines covering all 3 formats
- `validators.test.ts` — Validation rules and edge cases
- `game-data-detector.test.ts` — Traditional extraction and LLM parsing

Run tests: `npm test`

## Dependencies

- `$lib/ai/chat-stream.ts` — Streaming LLM responses
- `$lib/ai/provider.ts` — Model creation
- `$lib/db/*` — Database operations (stories, acts, act-lines, messages)
- `$lib/fs/prompts.ts` — Prompt loading system
- `$lib/fs/story-folders.ts` — Story folder resolution
- `$lib/utils/async.ts` — Shared `sleep()` and `isAuthError()`
- `$lib/utils/string.ts` — `toKebabCase()` for file naming

## Prompt Files (in prompts/)

- `import/act-generation-prompt.md` — LLM instructions for act generation
- `import/choices-extraction-prompt.md` — LLM instructions for game data extraction

These are registered in `$lib/fs/prompts.ts` and loaded via the `Prompt` class pattern.

## Security Considerations

- File size limits prevent DoS via large uploads
- File type validation restricts to expected extensions
- Cleanup on failure prevents orphaned database records
- Auth errors fail fast to avoid wasted API calls
- Rate limiting (100ms) between LLM calls respects provider limits
