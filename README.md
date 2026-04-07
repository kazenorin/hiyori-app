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

Cross-compiling Tauri to Windows from Linux requires the MSVC toolchain via `xwin`, `clang`, `lld`, and `llvm`.

### 1. Install cross-compilation tools

```bash
# Add the Windows MSVC target to Rust
rustup target add x86_64-pc-windows-msvc

# Install xwin (downloads MSVC CRT/SDK headers and libs)
cargo install xwin

# Install clang, lld, and llvm (provides lld-link linker and llvm-rc resource compiler)
sudo apt install -y clang lld llvm
```

### 2. Download MSVC CRT and SDK

```bash
xwin --accept-license splat --output ~/.xwin
```

This creates the following directories:

```
~/.xwin/
  crt/          # C runtime headers and libs
  sdk/          # Windows SDK headers and libs
```

### 3. Configure the Cargo linker

The file `src-tauri/.cargo/config.toml` configures `lld-link` as the linker and points to the `xwin` library paths:

```toml
[target.x86_64-pc-windows-msvc]
linker = "lld-link"
rustflags = [
  "-C", "target-feature=+crt-static",
  "-L", "/home/<USER>/.xwin/crt/lib/x86_64",
  "-L", "/home/<USER>/.xwin/sdk/lib/um/x86_64",
  "-L", "/home/<USER>/.xwin/sdk/lib/ucrt/x86_64",
]
```

Update the paths if your `xwin` output is in a different location.

### 4. Build the Windows binary

```bash
npm run tauri build -- --target x86_64-pc-windows-msvc
```

Output:

| Artifact | Path |
|----------|------|
| .exe | `src-tauri/target/x86_64-pc-windows-msvc/release/app.exe` |

The `.exe` includes the embedded frontend assets and requires [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 10/11).

> **Note:** NSIS/MSI installer bundling is not supported when cross-compiling. For a full Windows installer, build natively on Windows or use CI.

## Project Structure

```
src/                      # SvelteKit frontend
  routes/
    +layout.ts            # SSR disabled, prerender enabled
    +page.svelte          # Main UI with greet button
  app.html                # HTML shell
src-tauri/                # Tauri (Rust) backend
  src/
    lib.rs                # Greet command handler
    main.rs               # App entry point
  .cargo/config.toml      # Cross-compilation linker config
  tauri.conf.json         # Tauri app configuration
  Cargo.toml              # Rust dependencies
svelte.config.js          # SvelteKit with adapter-static (SPA fallback)
vite.config.ts            # Vite dev server on port 1420
```

## License

ISC
