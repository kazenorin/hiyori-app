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

## Reference Material

Check `local-references/*` for local reference files (if any).

## Story Folders

Each story gets a dedicated folder in AppData containing its own `system-prompt.md`. The global `system-prompt.md` at the AppData root serves as the default template — when a story folder is created, the default prompt is copied into it.

- **Folder naming**: Derived from the story name via `canonicalName()` (strips `/ \ < > : " | ? *` and control chars, supports Unicode). If two stories share the same name, the later one gets a short UUID suffix (e.g., `My Story - a1b2`). If the canonical name is empty (all chars sanitized), `deriveStoryName()` falls back to `story-{shortId}`.
- **Resolution**: `resolveStoryFolder()` in `src/lib/fs/story-prompts.ts` handles folder lookup. It checks the `story_folders` DB table first, then falls back to filesystem scanning. Exact name matches are preferred; UUID suffix is used only on collision.
- **Prompt switching**: When a story is selected, its system prompt is loaded via `loadStorySystemPrompt()` and cached in the stories store. Chat messages use this story-specific prompt.

## World Builder

The world builder is an AI-guided interview that creates a story's world document. It runs in a separate mode within the main page (`+page.svelte`), toggled by `getIsWorldBuilderActive()`.

- **State**: `src/lib/ai/world-builder.svelte.ts` — Svelte 5 runes with `$state()`. Tracks messages, streaming state, completion status, and log file path.
- **Shared streaming**: Uses `streamChatResponse()` from `chat-stream.ts` — same full parser chain as main chat. The world builder's state callback only reads `state.content` and ignores `gameData`/`reasoning`, but parsing still runs.
- **Completion marker**: The AI emits `[WORLD_BUILDER_COMPLETE]` followed by the story name and Markdown world document. `extractCompletionData()` parses this into `{ storyName, worldContent }`.
- **Story creation**: `createStoryFromWorldBuilder()` in `stories.svelte.ts` creates the story, act, act line, writes `world.md`, moves the temp log, then selects the new story.
- **Logging**: World builder logs are written to `AppData/logs/worldbuilding-{yyyyMMddHHmmss}.log` during the session. After story creation, `moveWorldBuilderLog()` moves the log into the story folder.
- **Chat actions**: Copy, regenerate, and delete work the same as the main chat. `regenerateLastWorldBuilderResponse()` removes the last assistant message and calls `streamNextResponse()`. `deleteLastWorldBuilderExchange()` removes the last user+assistant pair.

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

- **`streaming.ts`**: Low-level `executeStream()` wraps the Vercel AI SDK `streamText()`. Emits `onTextDelta`, `onReasoningDelta`, then `onComplete` with `StreamResultMetadata` (or `onError`). Returns void — lifecycle is callback-driven.
- **`chat-callbacks.ts`**: `createStreamAccumulator()` wires the parser chain into `StreamCallbacks`. Accumulates immutable `StreamState` (`content`, `reasoning`, `gameData`). Exposes `resultMetadata` as a `Promise` resolved on `onComplete`.
- **`parser-chain.ts`**: Chains thinking-tag parser then game-data parser. `feed()` returns `ParserChainOutput` (`text`, `thinking`, `gameData`). `flush()` drains buffered state.
- **`thinking-tag-parser.ts`**: Character-by-character state machine that extracts `<think...>...</think >` blocks. Separates reasoning content from visible text.
- **`message-updater.ts`**: Pure immutable helpers for `StreamState` updates: `applyParserOutput`, `applyReasoningDelta`. Private `isValidGameData()` validates game data before applying.
- **`chat-stream.ts`**: Shared library function `streamChatResponse()` — creates model, accumulator, calls `executeStream`, returns `MessageMetadata`. Used by both `chat.svelte.ts` and `world-builder.svelte.ts`.

## Thinking Tags

AI models emit reasoning in `<think...>...</think >` tags. The `ThinkingTagParser` (character-by-character state machine) extracts these during streaming and separates them from visible content.

- **Parser**: `src/lib/ai/thinking-tag-parser.ts` — states: TEXT → POTENTIAL_OPENER → THINKING_BODY → POTENTIAL_CLOSER. Uses `THINK_TAG_NAME` constant.
- **Integration**: Wired via `parser-chain.ts` before the game-data parser.

## Game Data Blocks

During main chat streaming, ```json blocks containing `worldState` (string) and `decisions` (string[]) are intercepted and hidden from chat content.

- **Parser**: `src/lib/ai/game-data-parser.ts` — character-by-character state machine (TEXT → POTENTIAL_OPENER → JSON_BODY → POTENTIAL_CLOSER) that buffers during streaming.
- **Validation**: Private `isValidGameData()` in `message-updater.ts` — skips game data with blank `worldState` or empty `decisions` array.
- **Rendering**: Decisions are rendered as clickable buttons below messages. Game data shows in a collapsed accordion on the assistant message card. Buttons are limited to 2 lines via `line-clamp`.
- **History injection**: `toHistoryMessage()` in `chat.svelte.ts` appends game data JSON to message content when building LLM history, so the model sees prior game state.
- **Persistence**: `game_data` column in `messages` table (migration 4). Canonical types: `GameData` interface and `parseGameData()` in `src/lib/db/messages.ts`.
- **Shared message safety**: `removeLastMessageEntries()` in `act-lines.ts` only deletes `messages` rows when no other act line references them (prevents data loss on forked lines).

## Scroll Behavior

Auto-scroll uses two observers on `chatContainer` (shared by main chat and world builder):

- **IntersectionObserver**: Watches the streaming cursor span (`streamingCursor` for main chat, `wbStreamingCursor` for world builder). If visible, `stuckToBottom = true`.
- **MutationObserver**: Fires on every DOM mutation. Scrolls to bottom when `stuckToBottom` is true.
- User can "detach" by scrolling up (cursor leaves viewport). Sending a message or clicking a decision forces `stuckToBottom = true`.

## Text Size Controls

The UI supports dynamic typography scaling via a sidebar slider and keyboard shortcuts:

- **Slider**: Range input in `+layout.svelte` sidebar footer, range 0.7–1.5, step 0.05. Persisted in `settings.fontSize`.
- **Ctrl+Scroll**: Holding Ctrl and scrolling adjusts font size by ±0.05 increments, clamped to 0.7–1.5.
- **Rendering**: `MarkdownContent.svelte` applies the scale factor to its content container.

## IntelliJ MCP Usage

When using IntelliJ MCP tools, first check whether the current shell is WSL2 by running `which wslpath`.

If `wslpath` is available, convert the project path to a Windows path before passing it to IntelliJ MCP:

```bash
$(wslpath -w "$ProjectPath")
```

where `$ProjectPath` is the current project directory.