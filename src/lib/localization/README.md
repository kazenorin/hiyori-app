# Localization

> **Last updated:** 2026-06-13 | **Version:** 0.5.0

Three separate systems handle different localization needs. The key distinction: **`t()`** is for UI, **`ls()`** is for LLM-facing strings, and **`LocalizedTemplateFile`** is for full prompt/template files.

---

## Architecture Overview

| System                  | Function                            | Scope                                         | Locale Source                                | Reactivity                     | Data Format              |
| ----------------------- | ----------------------------------- | --------------------------------------------- | -------------------------------------------- | ------------------------------ | ------------------------ |
| **i18n**                | `t(key, params?)`                   | UI (buttons, menus, dialogs)                  | Settings locale                              | Svelte 5 `$derived` — reactive | Flat JSON                |
| **locale-strings**      | `ls(key, params?)`                  | LLM strings (prompts, headers, tool messages) | Story locale → settings fallback             | None — imperative, cached      | YAML → flat dot-path map |
| **localized templates** | `loader.load()` / `.loadForStory()` | Full `.md` prompt/template files              | `activeLocale` (set via `setActiveLocale()`) | None — imperative              | Markdown files           |

---

## 1. i18n — UI Translations (`t()`)

- **Module:** `src/lib/i18n/index.svelte.ts`
- **Locale files:** `src/lib/i18n/locales/{locale}.json` (compile-time imported)
- **API:** `t(key, params?)` — reactive via Svelte 5 `$derived`
- **Reactivity:** `translations` is a `$state` rune; `flatTranslations` is `$derived` from it. Any `t()` call in a component re-renders on locale change.
- **Locale source:** Global settings locale — unaffected by story selection
- **Scope:** UI labels, buttons, menus, dialogs — **never** LLM input/output
- **Overrides:** None — bundled JSON only, no AppData or story-level overrides
- **Parameterization:** `{{param}}` syntax, replaced via `String.replaceAll()`

### Supported Locale Files

| File                                   | Lines |
| -------------------------------------- | ----- |
| `src/lib/i18n/locales/en.json`         | ~580  |
| `src/lib/i18n/locales/zh-Hant-HK.json` | ~575  |

### Key Structure

Top-level keys: `app`, `common`, `settings`, `chat`, `sidebar`, `bottomNav`, `mobileInput`, `choicesSheet`, `components`, `characterCards`, `importWorld`, `memoryManager`, `fileManager`, `loadStory`, `errors`, `tts`.

### Lifecycle

1. App init calls `loadLocale(settings.locale)` → sets `translations` state
2. `t(key)` reads from `flatTranslations` (reactive)
3. Settings locale change → `loadLocale(newLocale)` → `translations` updates → all `t()` calls re-render

---

## 2. Locale Strings — LLM-Facing Strings (`ls()`)

- **Module:** `src/lib/localization/index.ts`
- **Bundled files:** `src/lib/fs/locale-strings/{locale}.yaml` (`?raw` imported)
- **Runtime path:** `config/<locale>/locale-strings.yaml` (AppData)
- **API:** `ls(key, params?)` — non-reactive, cached flat lookup
- **Locale source:** Story locale (falls back to settings locale when no story active)
- **Parameterization:** `{{param}}` syntax, replaced via regex `/\{\{(\w+)}}/g`
- **Loader:** `LocaleStringBundle` (`src/lib/fs/locale-string-loader.ts`) with deep-merge for story overrides

### Supported Locale Files

| File                                        | Lines |
| ------------------------------------------- | ----- |
| `src/lib/fs/locale-strings/en.yaml`         | ~570  |
| `src/lib/fs/locale-strings/zh-Hant-HK.yaml` | ~560  |

### Resolution Order

```
1. Story override:  <story-folder>/locale-strings.yaml
2. Base file:       config/<locale>/locale-strings.yaml
3. Bundled default: (in-memory YAML)
```

Deep-merge algorithm: nested objects are recursively merged; arrays and primitives are overwritten entirely by the source. The merged tree is then flattened into dot-path keys via `flattenToPaths()`.

### Cache Mechanism

- Module-level `let cache: Record<string, string> = {}`
- Every `loadLocaleStrings()` call **replaces the entire cache** with `cache = flattenToPaths(data)`
- `ls(key)` does a simple `cache[key]` lookup; missing keys log a warning and return the raw key
- **Not reactive** — consumers call `ls()` imperatively at the point of use

### Bundle Resolution

`getBundle(locale)` maps `'zh-Hant-HK'` → `zhHantHkBundle`; all other values → `enBundle`. To add a new locale, create a new `LocaleStringBundle` and add it to both the bundle map and `registerLocaleStringDefaults()`.

### Usage

```typescript
import { ls } from '$lib/localization';

ls('common.headers.worldContent'); // → "World Content"
ls('pipeline.extraction.reviewer', { currentScene: 5 }); // parameterized
ls('pipeline.labels.sceneCountPlural', { count: 3 }); // parameterized
```

### Consumer Bridge Modules

Most `ls()` calls are mediated through two bridge modules rather than called directly:

- **`src/lib/definitions/common-headers.ts`** — 30+ header functions (e.g., `worldContentHeader()`, `playerResponseHeader()`)
- **`src/lib/definitions/pipeline-prompts.ts`** — 60+ extraction prompt, label, and sub-prompt functions (e.g., `gameMasterExtractionPrompt()`, `writerGuidanceExtractionPrompt()`)

AI tools also call `ls()` directly for their descriptions, parameters, and result messages (see `src/lib/ai/tools/`).

### YAML Structure (Top-Level Keys)

| Key                          | Purpose                                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `common`                     | Labels, headers, descriptions shared across the app (player, scene, location, etc.)                                                                   |
| `pipeline`                   | Headers, extraction prompts, labels, system prompts for the narrative generation pipeline                                                             |
| `pipeline.extraction`        | Writer/Reviewer/Editor/GM/PlotPlanner/Summarizer extraction prompts                                                                                   |
| `pipeline.extraction.writer` | Writer sub-prompts (providedSummary, turnOfEvents, directorNotes, actEnd, epilogue, guidance/phaseEvent extraction)                                   |
| `pipeline.labels`            | Display labels (acceptAsIs, totalViolations, actPhases, sceneCount, etc.)                                                                             |
| `pipeline.system`            | System prompts (templateFitter)                                                                                                                       |
| `features`                   | Character card generator, act card generator, world builder, interview, import, world generator/updater, important phrases                            |
| `tools`                      | AI tool definitions: selectWorldTemplate, evaluateRisk, queryMemories, queryInventory, readActPlot, advancePhase, endAct, readScene, readDistantScene |

---

## 3. Localized Prompts & View Templates

- **Module:** `src/lib/fs/prompt-loader.ts`
- **Declarations:** `src/lib/fs/prompts.ts`, `src/lib/fs/view-templates.ts`
- **Bundled files:** `src/lib/fs/{locale}/prompts/**/*.md`, `src/lib/fs/{locale}/view-templates/*.md`
- **Runtime paths:** `config/<locale>/prompt-templates/`, `config/<locale>/view-templates/` (AppData)
- **Locale source:** `activeLocale` (set via `setActiveLocale()`, driven by story locale)

### Class Hierarchy

```
LocalizedTemplateFile (abstract base)
├── LocalizedPromptFile    → config/<locale>/prompt-templates/
└── LocalizedViewTemplateFile → config/<locale>/view-templates/
```

- `LocalizedTemplateFile` holds `relativePath` + locale-keyed `defaultContent`
- `baseDir` is resolved **dynamically** at access time via `activeLocale`, so locale switches take effect immediately
- `getDefaultContent(locale)` falls back to `'en'` if the requested locale has no bundled content

### Resolution Order

```
1. Story-specific:  <story-folder>/<locale>/<templatesDir>/<relativePath>
2. Base file:       config/<locale>/<templatesDir>/<relativePath>
3. Bundled default: (in-memory, locale-specific)
```

Note the story override path includes the `<locale>/` segment, unlike locale-strings which is a single file.

### Prompt Files (`src/lib/fs/prompts.ts`)

Prompt files are organized by category under `src/lib/fs/{locale}/prompts/`:

```
writer/              reviewer/            game-master/
editor/              plot-planner/        summarizer/
world/               act/                 memories/
character/           general-instructions.md
```

Each subdirectory contains one or more `.md` files. All are declared as `PromptLoader` instances via the `createLoader(path)` factory, which returns `loadByStory(storyId, storyName)` and `loadDefault()` methods. See `src/lib/fs/prompts.ts` for the current list.

### View Template Files (`src/lib/fs/view-templates.ts`)

View template files live under `src/lib/fs/{locale}/view-templates/`. See `src/lib/fs/view-templates.ts` for the current list. Accessed via `loadStoryMessageTemplate()` and `loadStoryMessageTemplateForStory(storyId, storyName)`.

### Config Manifest

Prompt and view template files on disk are tracked by the config manifest system (`src/lib/fs/config-manifest.ts` + `src/lib/fs/config-assets-manifest.yaml`). The manifest records SHA-256 hashes for each file and supports tombstones (removed files). Run `npm run update-manifest` (via `scripts/update-config-manifest.mjs`) to regenerate the manifest after adding, removing, or modifying bundled template files.

---

## `t()` vs `ls()` Quick Reference

|                   | `t()` (i18n)                                    | `ls()` (locale-strings)                                  |
| ----------------- | ----------------------------------------------- | -------------------------------------------------------- |
| **Purpose**       | UI-facing strings (buttons, menus, dialogs)     | LLM-facing strings (prompts, headers, tool messages)     |
| **Reactivity**    | Svelte 5 `$derived` — reactive on locale change | Plain function — no Svelte reactivity                    |
| **Consumers**     | Svelte components, routes                       | AI modules, tools, pipeline, prompt builders             |
| **Overrides**     | Bundled JSON only (no story/AppData layer)      | Story-specific + base config + bundled defaults (3-tier) |
| **Loaded by**     | `loadLocale(locale)` / `setLocale(locale)`      | `loadLocaleStrings(locale, storyId?, storyName?)`        |
| **Data source**   | Static JSON imports                             | YAML (bundled + AppData + story override)                |
| **Locale driver** | Settings locale                                 | Story locale → settings fallback                         |
| **Param syntax**  | `{{param}}` via `replaceAll()`                  | `{{param}}` via regex                                    |

---

## Locale Switching

| Event                   | `activeLocale`                       | `ls()` reloads                            | `t()` uses                  |
| ----------------------- | ------------------------------------ | ----------------------------------------- | --------------------------- |
| Story selected          | Story's `locale` field               | Story locale + story override             | Settings locale (unchanged) |
| Story deselected        | Settings locale                      | Settings locale                           | Settings locale             |
| Settings locale changed | Settings locale (if no story active) | New settings locale (if no story active)  | New settings locale         |
| World builder entered   | Settings locale                      | Settings locale                           | Settings locale             |
| Pipeline execution      | Story's `locale` field               | Story locale (re-ensures cache is loaded) | Settings locale (unchanged) |

### Switching Code Path

Story selection (`src/lib/stores/stories.svelte.ts` → `selectStory()`):

```typescript
// Story selected:
setActiveLocale(story.locale || 'en');
await loadLocaleStrings(story.locale || 'en', story.id, story.name);

// Story deselected:
setActiveLocale(settings.locale || 'en');
await loadLocaleStrings(settings.locale || 'en');
```

Pipeline execution (`src/lib/ai/chat.svelte.ts`):

```typescript
await loadLocaleStrings(story.locale);
setActiveLocale(story.locale);
```

---

## Config Seeding & Sync

### `SUPPORTED_LOCALES`

```typescript
export const SUPPORTED_LOCALES = ['en', 'zh-Hant-HK'] as const; // in prompt-loader.ts
```

Currently supported: **en** (English), **zh-Hant-HK** (Traditional Chinese, Hong Kong).

### App Initialization Flow

`src/lib/app/init.svelte.ts` runs during app startup:

1. `loadLocale(settings.locale)` — sets `t()` translations
2. `setActiveLocale(settings.locale)` — sets `activeLocale` for prompt/template loading
3. `loadLocaleStrings(settings.locale)` — populates `ls()` cache
4. `ensureAllBaseConfigs()` — seeds prompt/template files for ALL supported locales in AppData
5. `ensureAllLocaleStringConfigs()` — seeds locale-string YAML files for ALL supported locales in AppData

### `ensureAllBaseConfigs()`

Iterates `SUPPORTED_LOCALES × defaultsRegistry` (Cartesian product). For each combination:

1. Resolves `baseDir` and `defaultContent` for that locale
2. Checks tombstone paths from the config manifest — skips files marked as deleted (`hash === null`)
3. Creates missing files from bundled defaults via `ensureBaseFileExists()`
4. Calls `syncConfigAssets()` to update files where the bundled hash differs from disk (skips user-edited files)

### `ensureAllLocaleStringConfigs()`

Iterates all registered `LocaleStringBundle` instances. Calls `ensureBaseFileExists()` for each, creating the YAML file in AppData if it doesn't exist. Does **not** overwrite existing files.

### Config Manifest (`src/lib/fs/config-manifest.ts`)

- `registerBundledContent(configPath, content)` builds an in-memory map of bundled content by config path
- `syncConfigAssets()` uses SHA-256 hashes to detect user edits — only overwrites files that haven't been modified by the user
- Tombstone entries (`hash === null`) represent files removed in newer versions; user-edited tombstone files are kept, unedited ones are deleted

---

## Directory Structure

### Bundled Defaults (`src/lib/fs/`)

```
en/
  prompts/**/*.md           (see prompts.ts for current list)
  view-templates/*.md      (see view-templates.ts for current list)
zh-Hant-HK/
  prompts/**/*.md           (mirrors en/)
  view-templates/*.md       (mirrors en/)
locale-strings/
  en.yaml
  zh-Hant-HK.yaml
```

### AppData Runtime

```
config/<locale>/
  prompt-templates/         (mirrors bundled structure)
  view-templates/           (mirrors bundled structure)
  locale-strings.yaml       (mirrors bundled YAML)
```

### Story Overrides

```
<story-folder>/
  locale-strings.yaml                        (overrides ls() strings via deep-merge)
  <locale>/prompt-templates/<relativePath>   (overrides prompt files, replaces entirely)
  <locale>/view-templates/<relativePath>     (overrides view templates, replaces entirely)
```

---

## Adding a New Locale

1. Add the locale code to `SUPPORTED_LOCALES` in `src/lib/fs/prompt-loader.ts`
2. Create `src/lib/i18n/locales/<locale>.json` with all UI translations
3. Create `src/lib/fs/locale-strings/<locale>.yaml` with all LLM-facing strings
4. Create `src/lib/fs/<locale>/prompts/` with all 31 prompt `.md` files
5. Create `src/lib/fs/<locale>/view-templates/story-message-template.md`
6. Register the new locale:
   - Add a loader entry in `src/lib/i18n/index.svelte.ts` (`localeLoaders`)
   - Create a `LocaleStringBundle` in `src/lib/localization/index.ts` and add it to `registerLocaleStringDefaults()` and `getBundle()`
   - Add glob imports in `src/lib/fs/prompts.ts` and `src/lib/fs/view-templates.ts`
7. Run `npm run update-manifest` to regenerate the config manifest
8. Test by switching locale in settings and verifying both UI (`t()`) and LLM (`ls()`) strings

---

## Key Source Files

| File                                      | Purpose                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/lib/localization/index.ts`           | `ls()` function, cache, `loadLocaleStrings()`, bundle registration                     |
| `src/lib/i18n/index.svelte.ts`            | `t()` function, `loadLocale()`, reactive translations                                  |
| `src/lib/fs/locale-string-loader.ts`      | `LocaleStringBundle`, deep-merge, `flattenToPaths()`, `ensureAllLocaleStringConfigs()` |
| `src/lib/fs/prompt-loader.ts`             | `LocalizedTemplateFile`, `SUPPORTED_LOCALES`, `activeLocale`, `ensureAllBaseConfigs()` |
| `src/lib/fs/prompts.ts`                   | All `PromptLoader` declarations and factory                                            |
| `src/lib/fs/view-templates.ts`            | View template declarations and loaders                                                 |
| `src/lib/fs/config-manifest.ts`           | Bundled content registry, hash-based sync, tombstone support                           |
| `src/lib/definitions/common-headers.ts`   | Bridge: `ls()` → LLM header functions                                                  |
| `src/lib/definitions/pipeline-prompts.ts` | Bridge: `ls()` → pipeline extraction/label functions                                   |
| `src/lib/stores/stories.svelte.ts`        | Story selection triggers `setActiveLocale()` + `loadLocaleStrings()`                   |
| `src/lib/ai/chat.svelte.ts`               | Pipeline re-ensures locale before execution                                            |
