# BYOA — Build Your Own Adventure

BYOA is an AI-powered interactive storytelling app built with Tauri v2 and SvelteKit 5. Create intricate stories through an AI-guided world builder, then play through branching narratives with real-time game state tracking, robust memory, and customizable AI pipelines.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Features](#features)
3. [User Guide](#user-guide)
4. [UI & Accessibility](#ui--accessibility)
5. [Developer Guide](#developer-guide)

---

## Quick Start

Get BYOA running in three simple steps:

1. **Download:** Grab the latest release for your platform (`.exe`, `.deb`/`.rpm`, or macOS) from the Releases page.
2. **Connect AI:** Open the app, go to **Settings → AI Providers**, and add your preferred provider (OpenAI, Anthropic, Ollama, etc.).
3. **Play:** Click **New Story → World Builder** to generate your first universe!

| Option            | How to Run                                          | Recommendation        |
| ----------------- | --------------------------------------------------- | --------------------- |
| **Installer**     | Download `BYOA_<version>.<ext>`                     | **Recommended**       |
| **Built SPA**     | `npm install && npm run build`, then serve `build/` | **Recommended (Web)** |
| **Online**        | Visit `https://byoa.kazenor.in` or self-host        | **No install needed** |
| **Dev server**    | `npm install && npm run dev`                        | For web development   |
| **Local desktop** | `npm install && npm run tauri dev` (requires Rust)  | For app development   |

> **Note:** Running the locally-built executable directly without the installer is not recommended, as the local data cache is not automatically erased between versions and can cause stale data issues.
> **Web App Note:** `localhost`/`127.0.0.1` is allowed on HTTP. All other hosts require HTTPS. An HTTPS web app can only call HTTPS providers or localhost providers. See the [WISP Proxy](#wisp-proxy--advanced-routing) section for CORS workarounds.

---

## Features

### Narrative Engine

- **Multi-Phase Pipeline:** A sequential orchestration of Writer → Reviewer → Editor → Game Master + Plot Planner, accompanied by an async Summarizer, Character Profile Compressor, and Memory extraction.
- **Write-Review-Edit Loop:** An optional feedback cycle to guarantee writing quality and narrative consistency.
- **Branching Narratives:** Fork storylines at any point. Each branch is an independent act line sharing messages up to the fork point.
- **Act Plots:** AI-generated scene-by-scene plot outlines with guided interview creation that drives the storytelling.
- **Director Notes:** Player-initiated directorial guidance to shift the narrative direction dynamically.
- **Act Transitions:** AI-assisted bridging between acts with strict continuity checks.
- **Risk Evaluation:** A dice-roll risk model for determining the outcome of risky actions.

### World Building & Content

- **World Builder:** An AI-guided interview that generates a comprehensive world document.
- **Import World:** Import chat transcripts (JSON, Markdown, text) as new stories with automatic act and character extraction.
- **Character & Act Cards:** Extract characters from acts; generate cards detailing personality, appearance, and story arcs.

### AI & Memory

- **Memory System:** Vector-based memory with semantic search (`sqlite-vec`). The AI recalls past events, locations, and character interactions via the `query-memories` tool.
- **Important Phrase Highlighting:** Background LLM extraction of key narrative phrases, visually emphasized in the prose (gated by Minor Task Agent setting).
- **Editor Mode:** An optional AI reviewer that validates continuity, character consistency, and narrative quality.

### Configuration & Data

- **Wide API Support:** Supports OpenAI, OpenAI-compatible, Anthropic, Ollama, and local endpoints via `chat-completions` or `responses` API formats.
- **Multi-Provider Assignment:** Assign different models to specific pipeline roles (e.g., a fast model for the Reviewer, a creative model for the Writer).
- **Fully User-Customizable Prompts:** Edit bundled default prompts or create story-specific overrides via the File Manager. Every AI-facing instruction can be tailored.
- **Story Export/Load:** Per-story `.zip` export with selective act line import (overwrite or load as a new story with remapped IDs). Full app data backup/restore is available via Settings.

---

## User Guide

### 1. Setting Up Your AI Provider

![Settings page showing AI provider configuration](docs/settings-page-dark.png)

Nothing works without an AI provider.

1. Go to **Settings → AI Providers** and click **+ Add Provider**.
2. Choose a provider type: **OpenAI Compatible**, **OpenAI**, or **Ollama**.
3. Fill in the **Base URL** and **Model** (use the **Fetch Models** button to auto-populate if supported).
4. Select the correct **API type**: `chat-completions` for most providers, `responses` only for OpenAI's `responses` API.

> **Ollama (Local) Users:** Set `OLLAMA_ORIGINS=*` on your Ollama server to allow browser CORS requests.

### 2. WISP Proxy & Advanced Routing

Since some API providers do not support CORS, API requests from the web app directly to those providers will fail.

- **WISP Protocol:** This app supports the [WISP-protocol proxy](https://github.com/MercuryWorkshop/wisp-protocol). You can easily proxy web app requests by setting up a local server using [wisp-server-python](https://github.com/MercuryWorkshop/wisp-server-python).
- **Advanced Usage (Cost & Token Management):** For power users managing multiple APIs, consider routing your BYOA requests through an intermediate gateway. Deploying a self-contained Docker Compose stack running LiteLLM on a local NAS is an excellent strategy to bypass CORS restrictions, unify your endpoints, and monitor your overall token usage without relying on a host-machine database.

### 3. Assigning Provider Roles

![Provider roles configuration panel](docs/provider-roles.png)

All pipeline roles default to your **Main Provider**. To optimize speed and cost, assign smaller/faster models to minor roles in **Settings → Pipeline Roles**.

- Enable the **Reviewer** to unlock the **Editor** role.
- You must assign a **Minor Task Agent** to enable phrase extraction and template fitting.

![Pipeline roles with detailed assignments](docs/pipeline-roles.png)

### 4. Playing the Narrative

The core loop: send a message → AI generates narrative → you choose a decision (or enter your own) → repeat.

- **Concluding Acts:** When an act ends, choosing "Continue to Next Act" creates a new act line. Choosing "End the story here" writes a concluding Epilogue.

  ![Act conclusion options showing Continue and End](docs/concluding-act.png)

- **Message Actions:** Every AI message features buttons to **Copy** (Markdown), **Read** (TTS), **Fork** (branch narrative), **Regenerate**, or **Edit** (reveals structured fields like scene title, background, and narrative that aren't visible in standard reading mode).

### 5. Branching Narratives (Forking)

![Fork dialog showing plot mode and branch options](docs/fork-dialog.png)

Forking lets you explore "what if" scenarios. Click **Fork** on any assistant message and choose:

- **Keep current plot:** Continue with the identical plot outline from the fork point.
- **Tell us what's different:** Describe the divergence in an interview, allowing the AI to generate an entirely new act plot for the branch.

### 6. Plot Planner & Act Plots

Enable the Plot Planner in **Settings → Pipeline Roles** to shape narrative direction before the Writer runs.

- **Event-based mode (Recommended):** Structures the story through narrative phases, prepares potential events/triggers, and runs at a configurable frequency (default is every 10 scenes).
- **Guidance-based mode:** Runs every turn with strong, Bethesda-style directional guidance.

### 7. Import Existing Content

You can import chat transcripts, world cards, and character profiles as new stories (supports Open WebUI JSON transcripts, Markdown, and text files).

- The multi-step wizard handles story details, acts, characters, and settings.
- Use the **Preview step** to review and remove individual messages before committing.
- _Note: Importing long chat histories is a token-heavy process._

![Import game data dialog for backing up stories](docs/import-game-data.png)

### 8. The Memory System (Desktop Only)

An advanced feature disabled by default (unavailable in the web app due to browser SQLite limitations).

- Requires both a **Memory provider** and an **Embedding provider**.
- Memory extraction runs automatically after narrative generation.
- Use the **Memory Manager** page to search past context by character, location, or both.

---

## UI & Accessibility

- **Dynamic Typography:** Use `Ctrl+Scroll` to adjust text size (70%–150%), or use the **Aa** slider in the sidebar.
- **Themes:** Choose from 23 color themes, plus System/Light/Dark modes.
- **Localization:** Fully supported in English and Traditional Chinese (Hong Kong).
- **Text-to-Speech (TTS):** Enable Kokoro-based TTS in Settings to read stories aloud (requires a one-time ~300MB WASM model download; English locales only).
- **Mobile Navigation:**
- Swipe right from the left edge to open the sidebar drawer.
- Use the bottom tab bar to switch between Chat, Choices, and Menu.
- Swipe right-to-left on stories/acts to **Delete**.

  ![Mobile swipe-to-delete gesture](docs/mobile-delete.png)

- Swipe left-to-right on stories/acts to **Rename**.

  ![Mobile swipe-to-rename gesture](docs/mobile-rename.png)

---

## Developer Guide

### Prerequisites

- [Node.js](https://nodejs.org/) v24+
- [Rust](https://www.rust-lang.org/tools/install) 1.77.2+

**Linux system dependencies:**
Tauri requires WebKit2GTK and related libraries:

```bash
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

```

_(If developing via WSL2, ensure Rust is installed directly within your WSL environment along with `build-essential gcc make`)._

### Building and Running

Start the Vite dev server (`http://localhost:1420`) and launch the Tauri hot-reload window:

```bash
npm install
npm run tauri dev

```

Build standalone platform binaries:

```bash
npm run tauri build

```

Build the standalone static Web App (SPA):

```bash
npm install
npm run build

```

The resulting `build/` directory can be deployed to any static host (Netlify, Vercel, GitHub Pages) or served locally. App data is stored in the browser via OPFS (Origin Private File System).

### Feature Internals

The preprocessor (`src/lib/utils/dialogue-preprocessor.ts`) applies highlighting with strict precedence: `dialogue > highlighted-phrase > character-name`. Each layer masks its regions so subsequent passes cannot match inside them.

When Phrase Highlighting is enabled, the `MinorTaskAgent` extracts important phrases in the background (fire-and-forget) after the Editor phase. Older messages are sequentially backfilled when an act line is loaded.

The `sqlite-vec` extension is globally registered via `main.rs` and available to JS queries.

- **Schema Constraints:** Requires explicit dimension definitions (e.g., `float[768]`).
- **IPC Limitations:** `tauri-plugin-sql` IPC cannot bind binary BLOBs from JS. You must pass vectors as JSON strings.
- **Primary Keys:** Use `last_insert_rowid()` in SQL, as JS numbers bind as `REAL` and `vec0` requires integers.
- **KNN Queries:** When JOINing with other tables, use a subquery pattern to ensure the `LIMIT` applies directly to the `vec0` virtual table scan.

Add the Windows GNU target and install the MinGW-w64 cross-compiler:

```bash
rustup target add x86_64-pc-windows-gnu
sudo apt install -y gcc-mingw-w64-x86-64 nsis

```

Build the `.exe`:

```bash
npm run tauri build -- --target x86_64-pc-windows-gnu

```

### License

ISC
