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
- **Completion marker**: The AI emits `[WORLD_BUILDER_COMPLETE]` followed by the story name and Markdown world document. `extractCompletionData()` parses this into `{ storyName, worldContent }`.
- **Story creation**: `createStoryFromWorldBuilder()` in `stories.svelte.ts` creates the story, act, act line, writes `world.md`, moves the temp log, then selects the new story.
- **Logging**: World builder logs are written to `AppData/logs/worldbuilding-{yyyyMMddHHmmss}.log` during the session. After story creation, `moveWorldBuilderLog()` moves the log into the story folder.
- **Chat actions**: Copy, regenerate, and delete work the same as the main chat. `regenerateLastWorldBuilderResponse()` removes the last assistant message and calls `streamNextResponse()`. `deleteLastWorldBuilderExchange()` removes the last user+assistant pair.

## Game Data Blocks

During main chat streaming, ```json blocks containing `worldState` (string) and `decisions` (string[]) are intercepted and hidden from chat content.

- **Parser**: `src/lib/ai/game-data-parser.ts` — character-by-character state machine (TEXT → POTENTIAL_OPENER → JSON_BODY → POTENTIAL_CLOSER) that buffers during streaming.
- **Rendering**: Decisions are rendered as clickable buttons below messages. Game data shows in a collapsed accordion on the assistant message card.
- **Persistence**: `game_data` column in `messages` table (migration 4). Canonical types: `GameData` interface and `parseGameData()` in `src/lib/db/messages.ts`.

## Scroll Behavior

Auto-scroll uses two observers on `chatContainer` (shared by main chat and world builder):

- **IntersectionObserver**: Watches the streaming cursor span (`streamingCursor` for main chat, `wbStreamingCursor` for world builder). If visible, `stuckToBottom = true`.
- **MutationObserver**: Fires on every DOM mutation. Scrolls to bottom when `stuckToBottom` is true.
- User can "detach" by scrolling up (cursor leaves viewport). Sending a message or clicking a decision forces `stuckToBottom = true`.

## IntelliJ MCP Usage

When using IntelliJ MCP tools, first check whether the current shell is WSL2 by running `which wslpath`.

If `wslpath` is available, convert the project path to a Windows path before passing it to IntelliJ MCP:

```bash
$(wslpath -w "$ProjectPath")
```

where `$ProjectPath` is the current project directory.