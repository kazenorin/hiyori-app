# BYOA — Build Your Own Adventure

An AI-powered interactive fiction desktop app built with [Tauri v2](https://v2.tauri.app/) and [SvelteKit 5](https://kit.svelte.dev/). Create stories through an AI-guided world builder, then play through branching narratives with real-time game state tracking.

## Features

- **World Builder** — AI-guided interview that generates a story's world document
- **Multi-Phase Narrative Pipeline** — Writer → Reviewer → Editor → Game Master + Plot Planner, with async Summarizer and Memory extraction phases
- **Branching Narratives** — Fork storylines at any point; each branch is an independent act line sharing messages up to the fork point
- **Game Data Blocks** — AI emits structured `worldState` and `decisions` during streaming, rendered as clickable decision buttons
- **Important Phrase Highlighting** — Background LLM extraction of key narrative phrases, rendered with visual emphasis (gated by Minor Task Agent setting)
- **Memory System** — Vector-based memory database with semantic search. AI recalls past events, locations, and character interactions via `query-memories` tool
- **Editor Mode** — Optional AI reviewer that validates continuity, character consistency, and narrative quality before displaying responses
- **Risk Evaluation** — Dice-roll risk model for determining action outcomes based on risk level
- **Import World** — Import existing chat transcripts (JSON, Markdown, text) as new stories with automatic act and character extraction
- **Character & Act Cards** — Extract characters from acts and generate detailed cards with personality, appearance, and story arcs
- **Act Plots** — AI-generated scene-by-scene plot outlines for each act line
- **Multi-Provider Support** — Configure multiple AI providers (OpenAI, OpenAI-compatible, Ollama) with per-role assignment
- **Dynamic Typography** — Sidebar slider and Ctrl+scroll to adjust text size (70%–150%)

## Prerequisites

| Tool                                            | Version |
| ----------------------------------------------- | ------- |
| [Node.js](https://nodejs.org/)                  | v24+    |
| [Rust](https://www.rust-lang.org/tools/install) | 1.77+   |
| [Cargo](https://doc.rust-lang.org/cargo/)       | 1.94+   |

### Linux system dependencies

Tauri requires WebKit2GTK and related libraries on Linux:

```bash
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

## Development

```bash
npm install
npm run tauri dev
```

This starts the Vite dev server on `http://localhost:1420` and launches the Tauri window with hot-reload.

### Rust Installation (WSL2)

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

## Building a Linux Binary

```bash
npm run tauri build
```

Output artifacts:

| Artifact | Path                                                          |
| -------- | ------------------------------------------------------------- |
| Binary   | `src-tauri/target/release/app`                                |
| .deb     | `src-tauri/target/release/bundle/deb/BYOA_0.1.0_amd64.deb`    |
| .rpm     | `src-tauri/target/release/bundle/rpm/BYOA-0.1.0-1.x86_64.rpm` |

## Cross-Compiling for Windows (from Linux)

Cross-compiling to Windows uses the GNU toolchain with MinGW-w64.

### 1. Install dependencies

```bash
# Add the Windows GNU target to Rust
rustup target add x86_64-pc-windows-gnu

# Install MinGW-w64 cross-compiler and NSIS installer builder
sudo apt install -y gcc-mingw-w64-x86-64 nsis
```

### 2. Build the Windows binary and installer

```bash
npm run tauri build -- --target x86_64-pc-windows-gnu
```

Output:

| Artifact       | Path                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- |
| .exe           | `src-tauri/target/x86_64-pc-windows-gnu/release/app.exe`                              |
| NSIS installer | `src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/BYOA_0.1.0_x64-setup.exe` |

The `.exe` includes the embedded frontend assets and requires [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 10/11).

## Project Structure

```
src/                      # SvelteKit frontend
  lib/
    ai/                   # AI pipeline, streaming, tools, world builder
    chat-stream-parser/   # Descriptor-based extraction from LLM markdown output
    db/                   # SQLite repositories (messages, stories, acts, act-lines, memory)
    memory/               # Vector memory class and extraction parser
    fs/                   # Prompt loading, view templates, story folders
      prompts/            # Bundled default markdown templates (by category)
    stores/               # Reactive state — settings, stories, act/character cards, memory
    import-world/         # Import transcript feature
    reviewer/             # Editor mode review loop
    logging/              # Structured logging (Tauri + file output)
    components/           # Shared Svelte components (MarkdownContent, ChatControls, etc.)
    utils/                # Async utilities, error handling, dialogue preprocessor
    app/                   # App initialization
  routes/
    +page.svelte          # Chat UI + world builder
    settings/             # Multi-provider, pipeline roles, feature toggles
    generate-character-cards/  # Character card generation
    import-world/         # Import transcript as new story
    memory-manager/       # Memory regeneration UI
src-tauri/                # Tauri (Rust) backend
  src/
    lib.rs                # Tauri setup and command handlers
    main.rs               # Entry point (sqlite-vec auto-extension registration)
svelte.config.js          # adapter-static (SPA fallback)
vite.config.ts            # Vite dev server on port 1420
```

## License

ISC
