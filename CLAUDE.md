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

- `local-references/openapi.with-code-samples.yml` — OpenAI API OpenAPI spec, used as a local reference for API integration.
- `local-references/llms-svelte.txt` — Skeleton.dev design system documentation (Svelte), used as a local reference for UI components and patterns.
