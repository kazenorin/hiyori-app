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
- **Character Cards** — Extract characters from acts and generate detailed character cards with personality, appearance, and story arcs
- **Act Cards** — Generate summary documents for entire acts from chat transcripts
- **Act Plots** — AI-generated scene-by-scene plot outlines for each act line
- **Thinking Tag Parsing** — Extracts `<think...>` reasoning from AI responses, displayed in a collapsible section
- **Dynamic Typography** — Sidebar slider and Ctrl+scroll to adjust text size (70%–150%)
- **Multi-Provider Support** — Configure multiple AI providers (OpenAI, OpenAI-compatible, Ollama) with per-role assignment
- **Structured Logging** — Chat logs written to AppData with configurable log levels (error/warn/info/debug)

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
    ai/
      pipeline.ts          # Narrative generation pipeline (Writer→Reviewer→Editor→GM‖PlotPlanner)
      pipeline-types.ts    # Pipeline state, callbacks, and type definitions
      chat.svelte.ts       # Main chat state and message management (Svelte 5 runes)
      chat-stream.ts       # Shared streaming function with retry support
      chat-callbacks.ts    # Stream accumulator with parser chain
      important-phrases-extractor.ts  # Background LLM phrase extraction (MinorTaskAgent)
      act-plot-generator.ts    # Act plot generation (Writer→Reviewer→Editor)
      act-summary-parser.ts   # Act summary parse, merge, serialize
      template-renderer.ts    # NarrativeVariables → template rendering
      world-builder.svelte.ts  # World builder mode state (Svelte 5 runes)
      world-generator.ts   # World generation from chat
      memory-extraction-pipeline.ts  # Memory extraction from assistant messages
      act-card-generator.ts    # Act summary card generation
      character-card-generator.ts  # Character card extraction and generation
      act-line-export.ts   # Export act line messages for AI processing
      card-output-path.ts  # Card file path construction
      descriptors.ts       # OutputDescriptor sets for each pipeline phase
      narrative-types.ts   # NarrativeVariables, GameDataFields, PhaseName types
      parser-chain.ts      # Chains thinking-tag → game-data parsers
      thinking-tag-parser.ts   # Extracts <think...> reasoning from stream
      game-data-parser.ts  # Extracts ```json game data blocks from stream
      message-updater.ts   # Immutable StreamState update helpers
      streaming.ts         # Low-level executeStream wrapper (Vercel AI SDK)
      provider.ts          # AI model factory
      models.ts            # Model registry
      risk-model.ts        # Risk evaluation dice-roll model
      reviewer-output-parser.ts  # Parses reviewer accept/fix decisions
      tools/               # LLM tools for chat
        tools.ts           # Tool builder combining all tool sets
        query-memories.ts  # Memory recall tool for AI
        query-inventory.ts # Inventory query and modification tool
        evaluate-risk.ts   # Risk evaluation tool
        read-act-plot.ts   # Read act plot file tool
        read-scene.ts      # Read scene messages tool
    chat-stream-parser/    # Descriptor-based extraction from LLM markdown output
      types.ts             # OutputDescriptor, match types (Header, List, etc.)
      parser.ts            # parseContent() dispatch and extraction logic
      index.ts             # Public exports
    db/                    # SQLite repositories
      database.ts          # Main database connection (singleton)
      migrations.ts        # Schema migrations (3 migrations)
      messages.ts          # Message CRUD, mapRowToMessage, parseImportantPhrases/serializeImportantPhrases
      stories.ts           # Story CRUD operations
      acts.ts              # Act CRUD operations
      act-lines.ts         # Act line management, branching, batch info resolution
      app-state.ts         # Application state persistence
      story-folders.ts     # Story folder path resolution
      memory-database.ts   # Separate connection for memory vectors
      memory-migrations.ts # Memory schema migrations
    memory/
      memory.ts            # Memory class with vector search (sqlite-vec)
      memory-extract-parser.ts  # Parses markdown extraction output
      inventory-types.ts   # Inventory category types
    fs/                    # File system services
      prompts.ts           # Unified prompt loading module (Prompt class instances)
      prompt-loader.ts     # Core Prompt class and loading logic
      view-templates.ts    # View template loading (story-message-template)
      story-folders.ts     # Story folder resolution and world content loading
      prompts/             # Bundled default markdown templates
        system-prompt.md
        general-instructions.md
        narration-template.md
        interview-extraction-prompt.md
        memories/          # Memory extraction prompts
        reviewer/          # Editor mode prompts
        editor/            # Editor system prompt
        writer/            # Writer system prompt + output template
        game-master/       # Game master system prompt
        plot-planner/      # Plot planner system prompt
        summarizer/        # Summarizer prompt + incremental templates
        features/          # Feature-specific prompts (important-phrases, etc.)
        world/             # World builder prompts
        act/               # Act card and plot prompts
        character/         # Character card prompts
        import/            # Import prompts
    stores/                # Reactive state (Svelte 5 runes)
      settings.svelte.ts   # Multi-provider configs, role assignments, feature toggles
      stories.svelte.ts    # Active story/act/actline selection, act plot management
      act-card.svelte.ts   # Act card generation state
      character-card.svelte.ts  # Character card generation state
      memory-regeneration.svelte.ts  # Memory regeneration workflow
    import-world/          # Import transcript feature
      import-orchestrator.ts  # Main import coordination
      transcript-parsers.ts    # Multi-format parsing (JSON, Markdown, text)
      game-data-detector.ts    # Detects structured game data in transcripts
      act-generator.ts     # Generates acts from parsed content
      validators.ts        # Import form validation
    reviewer/
      review-loop.ts       # Editor mode review cycle orchestration
    logging/               # Structured logging
      logger.ts            # Tauri log integration with file output
      chat-logger.ts       # Chat-specific logging helpers
    components/            # Shared Svelte components
      MarkdownContent.svelte  # Markdown rendering with dialogue/phrase highlighting and typography scaling
      ChatControls.svelte     # Chat action buttons (regenerate, delete, fork)
      WorldBuilderControls.svelte  # World builder action buttons
    utils/
      async.ts             # withRetry, isAuthError, sleepOrAbort
      error-handling.ts    # getErrorMessage
      dialogue-preprocessor.ts  # 7-step highlighting pipeline (dialogue > phrase > name)
    app/
      init.svelte.ts       # App initialization sequence
  routes/
    +layout.svelte         # Sidebar navigation, text size controls
    +layout.css            # Global styles
    +layout.ts             # SSR disabled, prerender enabled
    +page.svelte           # Chat UI + world builder
    settings/+page.svelte  # Settings page (multi-provider, pipeline/provider roles, features)
    generate-character-cards/+page.svelte  # Character card generation workflow
    import-world/+page.svelte  # Import transcript as new story
    memory-manager/+page.svelte  # Memory regeneration UI
  app.html                 # HTML shell
src-tauri/                # Tauri (Rust) backend
  src/
    lib.rs                # Tauri setup and command handlers
    main.rs               # App entry point (sqlite-vec auto-extension registration)
  tauri.conf.json         # Tauri app configuration
  Cargo.toml              # Rust dependencies
svelte.config.js          # SvelteKit with adapter-static (SPA fallback)
vite.config.ts            # Vite dev server on port 1420
```

## License

ISC
