---
name: prepare-release
argument-hint: '<version> [prev-tag]'
description: 'Build Hiyori release artifacts (Windows installer, Android aarch64 APK, Android universal APK), stage them under dist/release/<version>, then draft the release note from git history styled after the five most recently published releases. Use when: (1) Preparing or cutting a version release, (2) Building distributable .exe/.apk artifacts, (3) Drafting release notes from commits since the last tag, (4) Matching GitHub release-note style from tag history. Triggers on: "prepare release", "release vX.Y.Z", "build for release", "generate release notes", "发布版本", "打包发布", "release artifacts", "change log for a version".'
---

## Overview

Runs the full release sequence for a version: confirm the version is stamped, build the three artifacts in a fixed order, stage them with the project naming convention, and draft the release note from the commit range in the style of the published releases. Stops before any shared-state action (tag, push, GitHub release) and asks first.

Take the target version from the argument, else read it from `package.json`. The previous release is the newest tag **excluding the target**: `git tag --sort=-v:refname | grep -v "^<ver>$" | head -1`.

## Step 1 — Preflight

Do not start builds until all of these hold; each failure is silent until it wastes a build.

- **Version is stamped in both places.** `version` in `package.json` **and** `src-tauri/tauri.conf.json` must equal the target. Tauri derives artifact filenames from the conf value, so a stale one produces mislabeled binaries. `cd <ver>` / `chore: bump version to <ver>` must be on the release branch.
- **Release branch is fetched.** Work from `origin/main`, not a local branch: `git fetch origin main --tags`.
- **Android keystore exists** at `src-tauri/gen/android/key.properties` (keys: `storeFile`, `storePassword`, `keyAlias`, `keyPassword`). Without it the APK is unsigned.
- **NPM/Rust plugin versions align.** `@tauri-apps/*` and `tauri-plugin-*` must share major.minor, or the build aborts before compiling. `cargo build` output names the resolved crate; bump `package.json` to match.

If the release cycle edited bundled prompts, view-templates, names, or locale-strings, run the `prune-config-manifest` skill before building so the committed manifest diff carries only real asset changes.

## Step 2 — Build and stage, strictly in this order

Builds **must** be sequential: all three share the `src-tauri/target` Cargo lock, so overlapping builds block or corrupt each other. Each takes several minutes — run them as background commands and wait for completion rather than guessing.

Create the staging directory first: `mkdir -p dist/release/<ver>`.

**1. Windows** — `npm run tauri build`

Also emits an MSI at `src-tauri/target/release/bundle/msi/`; the convention stages only the NSIS installer. Output is already correctly named, so it is a plain copy:

```bash
cp src-tauri/target/release/bundle/nsis/Hiyori_<ver>_x64-setup.exe dist/release/<ver>/
```

**2. Android aarch64** — `npx tauri android build --target aarch64`

**The critical trap:** this writes to `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`. "universal" is the _Gradle product flavor_, not the ABI set — the aarch64 build and the universal build land on the **same path**, and the universal build overwrites it. Copy the aarch64 APK out immediately, before starting build 3:

```bash
cp src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk \
   dist/release/<ver>/Hiyori_<ver>_aarch64.apk
```

**3. Android universal** — `npx tauri android build`

Same source path; rename on copy:

```bash
cp src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk \
   dist/release/<ver>/Hiyori_<ver>_universal.apk
```

## Step 3 — Release note

### Style reference: the five most recent releases

Match the _published_ style, not a remembered one. Fetch the five tags immediately before the target:

```bash
ver=<ver>
for t in $(git tag --sort=-v:refname | grep -v "^$ver\$" | head -5); do
  curl -sS "https://api.github.com/repos/kazenorin/hiyori-app/releases/tags/$t" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("\n===== "+j.tag_name+" | title: "+j.name+" =====\n"+j.body)})'
done
```

- `body` is the published note. `name` is the release title, consistently `Hiyori v<ver>` — reuse it if the release gets created later.
- Use `--sort=-v:refname`. A plain or lexicographic sort places `1.10.0` _below_ `1.9.0`, silently selecting the wrong five releases.
- Exclude the target itself: a version is often tagged before its note is drafted, so the target can already appear in the tag list and, if published, would show up as its own style reference.
- Unauthenticated calls are capped at 60/hour (check `/rate_limit`); five per release is comfortable, but add `-H "Authorization: Bearer $GITHUB_TOKEN"` if a run needs more. On 403 or a missing release, fall back to `local-references/release-notes-v*.md`.
- Read all five before writing — the conventions only emerge across the set. The changelog link sits on **line 1** in four of the last five (1.8.0 alone puts a bare `1.7.1...1.8.0` range last), and a patch release like 1.7.1 can be a short prose with no section headings at all.

### Content

Range: `git log --oneline --no-decorate <prev-tag>..origin/main`, where `<prev-tag>` is the newest tag that is not the target.

Then re-read it with bodies: `git log --format='===%h %s%n%b' <prev-tag>..origin/main`. **The bodies carry the release.** Subjects say `feat(chat): add PhaseDialog`; the body documents navigation layout, scroll pinning, and close-on-switch behavior. Drafting from subjects alone produces a note that tells a user nothing.

Supplement from design docs under `local-references/<date>-<topic>/` when a commit references a spec, and check `src/lib/features/**/README.md` for semantics.

**Structure** for a feature release:

```markdown
**Full Changelog**: https://github.com/kazenorin/hiyori-app/compare/<prev>...<ver>

# Release v<ver>

## Features & Major Updates

### <Thematic Section>

- User-facing behavior, not commit restatement.

---

## Bug Fixes & Refactors

### Chat & Pipeline

### Desktop App

### System Stability & Maintenance

### Documentation
```

- Section headers name feature areas (e.g. "Phase Strip & Phase Dialog", "Settings: Provider Reordering"), never commits.
- Write what the user experiences; name settings, defaults, and thresholds.
- Bug fixes are one line each, phrased as _Fixed X — previously Y; now Z_.
- Skip merge commits and version-bump chores; they are not news.

Save to `dist/release/<ver>/release-notes-v<ver>.md`. `dist/` is gitignored (`.gitignore:19`) and lint-excluded (`eslint.config.js:13`), so staged binaries and the note never reach a commit — `git status` should stay clean throughout. That also means nothing here is version-controlled; sharing a note requires a tracked location by deliberate choice.

## Step 4 — Do not trust numeric claims

Commit messages and even prior release notes contain stale numbers. Before any concrete figure reaches the note, verify it against the code, and prefer omitting a number over asserting an unverified one.

- **Migration versions**: `migrationStatements` in `src/lib/db/migrations.ts` is a `string[][]` where the stored version is the **1-based group index** (`i + 1` in `runMigrations`). A commit body claiming "Migration v11" for the 8th group is wrong.
- **Archive version**: read `CURRENT_ARCHIVE_VERSION` and its history comment in `src/lib/features/story-export-load/archive-schema.ts`.
- **`postMigrationHooks`** keys are versions, so a hook keyed above the group count never fires — worth flagging if noticed, but it is not a release blocker and out of scope for the note.

## Step 5 — Stop before publishing

Finish by reporting the staged artifact paths and the note path. Do **not** create the git tag, push, or open the GitHub release without explicit approval — all three are shared-state and hard to reverse. Check first whether a release already exists (`curl -sS .../releases/tags/<ver>` returning 200 means it does) and say so rather than drafting a duplicate. Surface the remaining actions as the next step and wait.

## Red flags from past runs

- Running the universal build before staging the aarch64 APK, destroying it.
- Copying the MSI, or leaving the aarch64 APK named `app-universal-release.apk`.
- Drafting the note from `--oneline` subjects.
- Copying a schema/migration number out of a commit body into the note.
- Choosing the five reference releases with a lexicographic tag sort, or leaving the target version in the set.
