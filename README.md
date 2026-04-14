# BYOA — Build Your Own Adventure

An AI-powered interactive fiction desktop app built with [Tauri v2](https://v2.tauri.app/) and [SvelteKit 5](https://kit.svelte.dev/). Create stories through an AI-guided world builder, then play through branching narratives with real-time game state tracking.

## Features

- **World Builder** — AI-guided interview that generates a story's world document
- **Branching Narratives** — Fork storylines at any point; each branch is an independent act line sharing messages up to the fork point
- **Game Data Blocks** — AI emits structured `worldState` and `decisions` during streaming, rendered as clickable decision buttons
- **Character Cards** — Extract characters from acts and generate detailed character cards with personality, appearance, and story arcs
- **Act Cards** — Generate summary documents for entire acts from chat transcripts
- **Thinking Tag Parsing** — Extracts `<think...>` reasoning from AI responses, displayed in a collapsible section
- **Dynamic Typography** — Sidebar slider and Ctrl+scroll to adjust text size (70%–150%)
- **Structured Logging** — Chat logs written to AppData with configurable log levels

## Prerequisites

| Tool | Version |
|------|---------|
| [Node.js](https://nodejs.org/) | v24+ |
| [Rust](https://www.rust-lang.org/tools/install) | 1.77+ |
| [Cargo](https://doc.rust-lang.org/cargo/) | 1.94+ |

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

| Artifact | Path |
|----------|------|
| Binary | `src-tauri/target/release/app` |
| .deb | `src-tauri/target/release/bundle/deb/BYOA_0.1.0_amd64.deb` |
| .rpm | `src-tauri/target/release/bundle/rpm/BYOA-0.1.0-1.x86_64.rpm` |

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

| Artifact | Path |
|----------|------|
| .exe | `src-tauri/target/x86_64-pc-windows-gnu/release/app.exe` |
| NSIS installer | `src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/BYOA_0.1.0_x64-setup.exe` |

The `.exe` includes the embedded frontend assets and requires [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 10/11).

## Project Structure

```
src/                      # SvelteKit frontend
  lib/
    ai/
      chat-stream.ts      # Shared streaming function (used by chat + world builder)
      chat-callbacks.ts    # Stream accumulator with parser chain
      chat.svelte.ts       # Main chat state and message management (Svelte 5 runes)
      world-builder.svelte.ts  # World builder mode state (Svelte 5 runes)
      world-generator.ts   # World generation from chat
      act-card-generator.ts    # Act summary card generation
      character-card-generator.ts  # Character card extraction and generation
      act-line-export.ts   # Export act line messages for AI processing
      card-output-path.ts  # Card file path construction
      parser-chain.ts      # Chains thinking-tag → game-data parsers
      thinking-tag-parser.ts   # Extracts <think...> reasoning from stream
      game-data-parser.ts  # Extracts ```json game data blocks from stream
      message-updater.ts   # Immutable StreamState update helpers
      streaming.ts         # Low-level executeStream wrapper (Vercel AI SDK)
      provider.ts          # AI model factory
      models.ts            # Model registry
    db/                    # SQLite repositories
      stories.ts, acts.ts, act-lines.ts, messages.ts, app-state.ts, story-folders.ts
    fs/                    # File system services
      prompts.ts           # Unified prompt loading module (Prompt class instances)
      prompt-loader.ts     # Core Prompt class and loading logic
      prompts/             # Bundled default markdown templates
        system-prompt.md
        narration-template.md
        world/             # World builder prompt templates
        act/               # Act card prompt templates
        character/         # Character card prompt templates
      story-prompts.ts     # Story folder resolution and world content loading
    stores/                # Reactive state (settings, stories)
    components/            # Shared Svelte components (MarkdownContent, etc.)
    logging/               # Structured logging via tauri-plugin-log
  routes/
    +layout.svelte         # Sidebar navigation, text size controls
    +layout.css            # Global styles
    +layout.ts             # SSR disabled, prerender enabled
    +page.svelte           # Chat UI + world builder
    settings/+page.svelte  # Settings page
    generate-character-cards/+page.svelte  # Character card generation
  app.html                 # HTML shell
src-tauri/                # Tauri (Rust) backend
  src/
    lib.rs                # Tauri setup and command handlers
    main.rs               # App entry point
  tauri.conf.json         # Tauri app configuration
  Cargo.toml              # Rust dependencies
svelte.config.js          # SvelteKit with adapter-static (SPA fallback)
vite.config.ts            # Vite dev server on port 1420
```

## License

ISC
