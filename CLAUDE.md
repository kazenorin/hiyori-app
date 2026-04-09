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

- **Folder naming**: Derived from the story name via `canonicalName()` (strips `/ \ < > : " | ? *` and control chars, supports Unicode). If two stories share the same name, the later one gets a short UUID suffix (e.g., `My Story - a1b2`).
- **Resolution**: `resolveStoryFolder()` in `src/lib/fs/story-prompts.ts` handles folder lookup. It checks the `story_folders` DB table first, then falls back to filesystem scanning. Exact name matches are preferred; UUID suffix is used only on collision.
- **Prompt switching**: When a story is selected, its system prompt is loaded via `loadStorySystemPrompt()` and cached in the stories store. Chat messages use this story-specific prompt.

## IntelliJ MCP Usage

When using IntelliJ MCP tools, first check whether the current shell is WSL2 by running `which wslpath`.

If `wslpath` is available, convert the project path to a Windows path before passing it to IntelliJ MCP:

```bash
$(wslpath -w "$ProjectPath")
```

where `$ProjectPath` is the current project directory.