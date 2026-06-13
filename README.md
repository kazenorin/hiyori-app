# BYOA — Build Your Own Adventure

An AI-powered interactive fiction desktop app built with [Tauri v2](https://v2.tauri.app/) and [SvelteKit 5](https://kit.svelte.dev/). Create stories through an AI-guided world builder, then play through branching narratives with real-time game state tracking.

## Features

### Narrative Engine

- **Multi-Phase Pipeline** — Writer → Reviewer → Editor → Game Master + Plot Planner (sequential), with async Summarizer, Character Profile Compressor, and Memory extraction
- **Branching Narratives** — Fork storylines at any point; each branch is an independent act line sharing messages up to the fork point
- **Game Data Blocks** — Structured `worldState` and `decisions` emitted during streaming, rendered as clickable decision buttons
- **Act Plots** — AI-generated scene-by-scene plot outlines with guided interview creation
- **Turn of Events & Director Notes** — AI-generated narrative twists and directorial guidance
- **Act Transitions** — AI-assisted bridging between acts with continuity checks
- **Risk Evaluation** — Dice-roll risk model for determining action outcomes

### World Building & Content

- **World Builder** — AI-guided interview that generates a story's world document
- **Import World** — Import chat transcripts (JSON, Markdown, text) as new stories with automatic act and character extraction
- **Character & Act Cards** — Extract characters from acts; generate cards with personality, appearance, and story arcs

### AI & Memory

- **Memory System** — Vector-based memory with semantic search (sqlite-vec); AI recalls past events, locations, and character interactions via `query-memories` tool
- **Important Phrase Highlighting** — Background LLM extraction of key narrative phrases, visually emphasized (gated by Minor Task Agent setting)
- **Editor Mode** — Optional AI reviewer that validates continuity, character consistency, and narrative quality

### Data Portability

- **Story Export/Load** — Per-story zip export with selective act line import (overwrite or as new story with ID remapping). Full app data backup/restore via Settings

### Configuration & UX

- **Multi-Provider Support** — Multiple AI providers (OpenAI, OpenAI-compatible, Ollama) with per-role assignment
- **Localization** — Three-tier system: `t()` for UI, `ls()` for LLM-facing strings, localized prompt/template files (English and Traditional Chinese)
- **Text-to-Speech** — Kokoro-based in-browser speech synthesis for narrative playback
- **Dynamic Typography** — Sidebar slider and Ctrl+scroll to adjust text size (70%–150%)

## User Guide

> **TODO:** User-facing documentation — getting started, creating a story, playing through narratives, configuring providers, using the world builder, managing saves, etc.

---

## Developer Guide

### Prerequisites

| Tool                                            | Version |
| ----------------------------------------------- | ------- |
| [Node.js](https://nodejs.org/)                  | v24+    |
| [Rust](https://www.rust-lang.org/tools/install) | 1.77.2+ |

#### Linux system dependencies

Tauri requires WebKit2GTK and related libraries on Linux:

```bash
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### Development

```bash
npm install
npm run tauri dev
```

This starts the Vite dev server on `http://localhost:1420` and launches the Tauri window with hot-reload.

#### Rust Installation (WSL2)

Before working on the Tauri backend, ensure Rust is installed in WSL2:

1. **Install build dependencies** — Rust crates often compile from source:

   ```bash
   sudo apt update && sudo apt install build-essential gcc make -y
   ```

2. **Run the official rustup installer**:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
   When prompted, type `1` (default installation) and press Enter.

### Building a Linux Binary

```bash
npm run tauri build
```

Output artifacts:

| Artifact | Path                                                          |
| -------- | ------------------------------------------------------------- |
| Binary   | `src-tauri/target/release/app`                                |
| .deb     | `src-tauri/target/release/bundle/deb/BYOA_0.5.0_amd64.deb`    |
| .rpm     | `src-tauri/target/release/bundle/rpm/BYOA-0.5.0-1.x86_64.rpm` |

### Building the Standalone Web App

The same codebase produces a standalone web app that runs in any modern browser without Tauri. Runtime detection automatically selects the correct backends:

| Layer               | Tauri                                       | Web (browser)                                    |
| ------------------- | ------------------------------------------- | ------------------------------------------------ |
| Database            | `TauriDatabase` (native SQLite)             | `SqlJsDatabase` (WASM SQLite + OPFS persistence) |
| File system         | `TauriFileSystem` (`@tauri-apps/plugin-fs`) | `OpfsFileSystem` (browser OPFS API)              |
| HTTP                | `@tauri-apps/plugin-http` (CORS-free)       | `globalThis.fetch` (subject to CORS)             |
| Logging             | Tauri log plugin                            | Console + file via OPFS                          |
| Memory (sqlite-vec) | Enabled                                     | Disabled                                         |

#### Build

```bash
npm install   # postinstall copies sql-wasm.wasm to static/
npm run build # outputs to build/
```

The `build/` directory is a fully static SPA — deploy it to any static host (Netlify, Vercel, GitHub Pages, S3) or serve locally with `npx serve build`.

#### Requirements

- **HTTPS or localhost** — OPFS requires a secure context. `file://` protocol will not work.
- **Chromium-based browser** — OPFS and File System Access API are primarily supported in Chrome, Edge, and Opera. Firefox and Safari have limited or no support.
- **CORS** — LLM API calls use standard `fetch()`. Most providers (OpenAI, Anthropic) work fine. Self-hosted endpoints (especially Ollama) may require CORS configuration.

#### Data persistence

App data is stored in the browser via OPFS (Origin Private File System). Clearing browser data will erase it. Use the **Data → Export** button in Settings to create backups.

#### PWA

The web build includes a service worker (via `@vite-pwa/sveltekit`) that caches the app shell for offline use. On Chromium browsers, the app can be installed as a PWA via the browser's install prompt.

#### CORS note for Ollama

When running in the browser, API calls to local Ollama instances require the `OLLAMA_ORIGINS=*` environment variable to allow cross-origin requests.

### Cross-Compiling for Windows (from Linux)

Cross-compiling to Windows uses the GNU toolchain with MinGW-w64.

#### 1. Install dependencies

```bash
# Add the Windows GNU target to Rust
rustup target add x86_64-pc-windows-gnu

# Install MinGW-w64 cross-compiler and NSIS installer builder
sudo apt install -y gcc-mingw-w64-x86-64 nsis
```

#### 2. Build the Windows binary and installer

```bash
npm run tauri build -- --target x86_64-pc-windows-gnu
```

Output:

| Artifact       | Path                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- |
| .exe           | `src-tauri/target/x86_64-pc-windows-gnu/release/app.exe`                              |
| NSIS installer | `src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/BYOA_0.5.0_x64-setup.exe` |

The `.exe` includes the embedded frontend assets and requires [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 10/11).

### Project Structure

```
src/                      # SvelteKit frontend
  lib/
    ai/                   # AI pipeline, streaming, tools
      pipeline/           # Multi-phase narrative pipeline (orchestrator, runners, phase executor, summarizer)
      act-plot/           # Act plot generation and interview
      tools/              # AI tool definitions (read-scene, query-memories, evaluate-risk, etc.)
      world-generator/    # World document generation and updating
      chat/               # Chat pipeline config and provider resolution
    features/             # Feature modules
      world-builder/      # AI-guided world-building interview
      import-world/       # Import transcript feature
      character-card-generator/  # Character card extraction and generation
      act-card-generator/ # Act card generation
      story-export-load/  # Story .byoa archive export/import
      turn-of-events-generator/  # AI-generated narrative twists
      memory/             # Vector memory persistence and search
      act-transition.svelte.ts  # Act transition orchestration
      fork-controller.svelte.ts # Act line forking control
      message-editor.svelte.ts  # Message editing UI state
      data-import-export.ts     # Settings and data export helpers
    chat-stream-parser/   # Descriptor-based extraction from LLM markdown output
    db/                   # SQLite repositories (messages, stories, acts, act-lines, memory)
      adapters/           # Database adapter layer (Tauri vs web)
    definitions/          # Pipeline headers, labels, prompts, error messages
    fs/                   # Prompt loading, view templates, story folders
      prompts/            # Bundled default markdown templates (by category)
    stores/               # Reactive state — settings, stories, act/character cards, memory
    i18n/                 # UI translation (t() function, locale JSON files)
    localization/         # LLM locale strings (ls() function, YAML-backed)
    kokoro/               # TTS engine (Kokoro WASM, Web Audio playback)
    logging/              # Structured logging (Tauri + file output)
    http/                 # HTTP fetch abstraction
    components/           # Shared Svelte components (MarkdownContent, ChatControls, etc.)
    utils/                # Async utilities, error handling, dialogue preprocessor
    ui/                   # UI constants (icon definitions)
    styles/               # Theme CSS
  routes/
    +page.svelte          # Chat UI + world builder
    settings/             # Multi-provider, pipeline roles, feature toggles
    generate-character-cards/  # Character card generation
    import-world/         # Import transcript as new story
    load-story/           # Load .byoa archive
    memory-manager/       # Memory regeneration UI
    file-manager/         # Story file management
src-tauri/                # Tauri (Rust) backend
  src/
    lib.rs                # Tauri setup and command handlers
    main.rs               # Entry point (sqlite-vec auto-extension registration)
svelte.config.js          # adapter-static (SPA fallback)
vite.config.ts            # Vite dev server on port 1420
```

### Feature Internals

#### Dialogue Preprocessor

**`src/lib/utils/dialogue-preprocessor.ts`** — `preprocessDialogue(content, characterNames?, importantPhrases?)` applies highlighting with strict precedence:

**dialogue > highlighted-phrase > character-name**

Each layer masks its regions so subsequent passes can't match inside them.

#### Important Phrase Highlighting

Background LLM extraction + UI highlighting. After Editor phase, `extractImportantPhrases()` runs via MinorTaskAgent (fire-and-forget). On `sendMessage()` completion, the promise is resolved and phrases are persisted. On `loadActLineMessages()`, missing phrases are backfilled sequentially. `MarkdownContent.svelte` passes phrases to `preprocessDialogue()`.

#### Vector Data Types (sqlite-vec)

The `sqlite-vec` extension is available in all SQLite connections (registered process-globally via `main.rs`). All sqlite-vec SQL functions and the `vec0` virtual table module are available from JavaScript SQL queries.

#### Constraints

- **vec0 schema requires explicit dimension**: `float[N]` (e.g., `float[768]`), not bare `float`.
- **Vectors as JSON strings**: `tauri-plugin-sql` IPC cannot bind binary BLOBs from JavaScript. Pass vectors as JSON strings — sqlite-vec parses them natively.
- **Integer primary keys only**: Use `last_insert_rowid()` in SQL instead of passing rowids from JavaScript (JS `number` binds as REAL through IPC).
- **KNN queries require LIMIT on vec0 scan**: When JOINing with other tables, use a subquery pattern so the `LIMIT` is directly on the vec0 virtual table scan.

#### Example Usage (JavaScript)

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

### License

ISC
