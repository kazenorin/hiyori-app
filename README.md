# Hiyori — Build Your Own Adventure

<!--suppress HtmlDeprecatedAttribute -->
<div align="center">
  <!--suppress CheckImageSize -->
	<img src="docs/hiyori-logo.png" alt="Hiyori Logo" width="256">
</div>
Hiyori (日和) is an AI-powered interactive storytelling app built with Tauri v2 and SvelteKit 5.
Create intricate stories through an AI-guided world builder, then play through branching narratives with real-time game state tracking, robust memory, and customizable AI pipelines.

> **Looking for the details?** Everything beyond this page lives in the **[project wiki](https://github.com/kazenorin/hiyori-app/wiki)** — provider setup, role recommendations, gameplay guides, and developer documentation. See [Documentation](#documentation) below.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Features](#features)
3. [Documentation](#documentation)
4. [Developer Guide](#developer-guide)

---

## Quick Start

Get Hiyori running in three simple steps:

1. Either:
   - **Download:** Grab the latest release for Windows (`.exe` NSIS installer) from the Releases page, or
   - **Online:** Go to [GitHub Pages](https://kazenorin.github.io/hiyori-app/) for the web app version. No data is stored in the server. Or,
   - One of the other options below.
2. **Connect AI:** Open the app, go to **Settings → AI Providers**, and add your preferred provider (OpenAI, OpenAI-compatible, Ollama, etc.).
3. **Play:** Click **New Story → World Builder** to generate your first universe!

| Option            | How to Run                                                                                      | Recommendation            |
| ----------------- | ----------------------------------------------------------------------------------------------- | ------------------------- |
| **Installer**     | Download and install `Hiyori_<version>.exe`                                                     | **Recommended (Windows)** |
| **Built SPA**     | `npm install && npm run build`, then serve `build/`                                             | **Recommended (Web)**     |
| **Online**        | Visit [GitHub Pages](https://kazenorin.github.io/hiyori-app/) or self-host                      | **No install needed**     |
| **Dev server**    | `npm install && npm run dev`                                                                    | For web development       |
| **Local desktop** | `npm install && npm run tauri dev` (requires Rust)                                              | For app development       |
| **Android**       | See [Platform Builds](https://github.com/kazenorin/hiyori-app/wiki/Platform-Builds) in the wiki | For Android devices       |

> **Note:** Running the locally-built executable directly without the installer is not recommended, as the local data cache is not automatically erased between versions and can cause stale data issues.
> **Web App Note:** `localhost`/`127.0.0.1` is allowed on HTTP. All other hosts require HTTPS. An HTTPS web app can only call HTTPS providers or localhost providers. See [Getting Started](https://github.com/kazenorin/hiyori-app/wiki/Getting-Started) in the wiki for CORS workarounds.

---

## Features

### Narrative Engine

- **Multi-Phase Pipeline:** A sequential orchestration of Writer → Reviewer → Editor → Template Fitter → Game Master ‖ Plot Planner, accompanied by an async Summarizer → Character Profile Compressor → Memory extraction chain.
- **Write-Review-Edit Loop:** An optional feedback cycle (with detailed or quick review modes) to guarantee writing quality and narrative consistency.
- **Branching Narratives:** Fork storylines at any point. Each branch is an independent act line sharing messages up to the fork point.
- **Act Plots:** AI-generated scene-by-scene plot outlines with guided interview creation that drives the storytelling.
- **Act Phase System:** Event-based plot mode structures stories through narrative phases (introduction → rising action → climax → falling action → resolution) with milestone gating and configurable advancement thresholds.
- **Director Notes:** Player-initiated directorial guidance to shift the narrative direction dynamically.
- **Act Transitions:** AI-assisted bridging between acts with strict continuity checks.
- **Epilogue Generation:** A dedicated pipeline for story-ending epilogues with multiple ending types (good, bad, bittersweet, alternative).
- **Risk Evaluation:** A dice-roll risk model for determining the outcome of risky actions.
- **AI Tools:** Pipeline agents have access to tools including scene reading, memory/inventory queries, character introduction, risk evaluation, phase advancement, and act ending.

### World Building & Content

- **World Builder:** An AI-guided interview that generates a comprehensive world document. Supports updating existing world documents via the World Builder.
- **Import World:** Import chat transcripts (JSON, Markdown, text) as new stories with automatic act and character extraction.
- **Character & Act Cards:** Extract characters from acts; generate cards detailing personality, appearance, and story arcs. Manageable via the Context Management page.

### AI & Memory

- **Memory System:** Vector-based memory with semantic search (`sqlite-vec`). The AI recalls past events, locations, and character interactions via the `query-memories` tool.
- **Inventory Tracking:** Per-character item, equipment, skill, clothing, and status tracking with change history, queryable by AI agents via the `query-inventory` tool.
- **Character Profiles:** Compressed per-character profiles with configurable importance thresholds, maintained by the Character Profile Compressor.
- **Important Phrase Highlighting:** Background LLM extraction of key narrative phrases, visually emphasized in the prose (gated by Minor Task Agent setting).
- **Reviewer:** An optional AI reviewer (detailed or quick mode) that validates continuity, character consistency, and narrative quality before the Editor runs.

### Configuration & Data

- **Wide API Support:** Supports OpenAI, OpenAI-compatible, and Ollama endpoints via `chat-completions` or `responses` API formats.
- **Multi-Provider Assignment:** Assign different models to specific pipeline roles (e.g., a fast model for the Reviewer, a creative model for the Writer).
- **Per-Provider CORS Bypass:** Configure WISP proxy or libcurl-based CORS bypass on a per-provider basis for web app usage.
- **Fully User-Customizable Prompts:** Edit bundled default prompts or create story-specific overrides via the File Manager. Every AI-facing instruction can be tailored.
- **Story Export/Load:** Per-story `.zip` export with selective act line import (overwrite or load as a new story with remapped IDs). Full app data backup/restore is available via Settings.
- **Context Management:** Generate and manage act cards and character cards for controlling what context is fed to the AI pipeline.

---

## Documentation

Detailed guides live in the **[wiki](https://github.com/kazenorin/hiyori-app/wiki)**. The wiki is also part of this repository as a git submodule at [`wiki/`](wiki) — run `git submodule update --init wiki` to check it out locally.

**Getting started**

- [Getting Started](https://github.com/kazenorin/hiyori-app/wiki/Getting-Started) — connect an AI provider, WISP proxy and CORS workarounds
- [Pipeline Roles](https://github.com/kazenorin/hiyori-app/wiki/Pipeline-Roles) — assign models per role, with recommendations and KV-cache notes

**Playing**

- [Playing the Story](https://github.com/kazenorin/hiyori-app/wiki/Playing-the-Story) — core loop, acts and epilogues, message actions, forking, plot planner
- [Importing Content](https://github.com/kazenorin/hiyori-app/wiki/Importing-Content) — start a story from an existing chat transcript
- [Memory System](https://github.com/kazenorin/hiyori-app/wiki/Memory-System) — desktop-only vector memory
- [UI & Accessibility](https://github.com/kazenorin/hiyori-app/wiki/UI-and-Accessibility) — typography, themes, localization, TTS, mobile gestures

**Developing**

- [Development Setup](https://github.com/kazenorin/hiyori-app/wiki/Development-Setup) — prerequisites, Linux and Windows environment setup, building and running
- [Platform Builds](https://github.com/kazenorin/hiyori-app/wiki/Platform-Builds) — Android APKs and Windows cross-compilation
- [Feature Internals](https://github.com/kazenorin/hiyori-app/wiki/Feature-Internals) — dialogue preprocessor, phrase highlighting, `sqlite-vec` constraints

---

## Developer Guide

### Prerequisites

- [Node.js](https://nodejs.org/) v24+
- [Rust](https://www.rust-lang.org/tools/install) 1.77.2+

Platform-specific setup — Linux system dependencies, the Windows `winget` walkthrough, and build troubleshooting — is covered in [Development Setup](https://github.com/kazenorin/hiyori-app/wiki/Development-Setup).

### Building and Running

```bash
npm install

npm run dev          # Vite dev server for the web app (http://localhost:1420)
npm run tauri dev    # desktop app with hot reload (requires Rust)
npm run build        # static web app (SPA) into build/
npm run tauri build  # standalone platform binaries
```

The `build/` directory can be deployed to any static host (Netlify, Vercel, GitHub Pages) or served locally. Web app data is stored in the browser via OPFS (Origin Private File System), and the web app is PWA-enabled.

For Android APKs and cross-compiling the Windows executable from Linux, see [Platform Builds](https://github.com/kazenorin/hiyori-app/wiki/Platform-Builds).

### License

AGPL-3.0-or-later. See [LICENSE](LICENSE) for details.
