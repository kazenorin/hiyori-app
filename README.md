# Hello Tauri + SvelteKit

A minimal hello world desktop app built with [Tauri v2](https://v2.tauri.app/) and [SvelteKit](https://kit.svelte.dev/).

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

## Building a Linux Binary

```bash
npm run tauri build
```

Output artifacts:

| Artifact | Path |
|----------|------|
| Binary | `src-tauri/target/release/app` |
| .deb | `src-tauri/target/release/bundle/deb/Hello Tauri_0.1.0_amd64.deb` |
| .rpm | `src-tauri/target/release/bundle/rpm/Hello Tauri-0.1.0-1.x86_64.rpm` |

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
    ai/                   # AI chat (streaming, provider, models)
    db/                   # SQLite repositories (stories, acts, messages)
    fs/                   # File system services (system prompt)
    stores/               # Reactive state (settings, stories)
  routes/
    +layout.ts            # SSR disabled, prerender enabled
    +page.svelte          # Chat UI
    settings/+page.svelte # Settings page
  app.html                # HTML shell
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
