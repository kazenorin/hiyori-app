# Localization

Three systems handle different localization needs. Key distinction: **i18n** is for UI, **locale-strings** and **localized templates** are for LLM I/O.

## 1. i18n — UI Translations (`t()`)

- **Source**: `src/lib/i18n/index.svelte.ts`
- **Files**: `src/lib/i18n/locales/{locale}.json` (compile-time imported)
- **API**: `t(key, params?)` — reactive via Svelte 5 `$derived`
- **Locale source**: Settings locale (user's global language preference)
- **Scope**: UI labels, buttons, menus — never LLM input/output

## 2. Locale Strings — LLM-Facing Strings (`ls()`)

- **Source**: `src/lib/localization/index.ts`
- **Bundled files**: `src/lib/fs/locale-strings/{locale}.yaml` (`?raw` imported)
- **Runtime path**: `config/<locale>/locale-strings.yaml` (AppData)
- **API**: `ls(key, params?)` — non-reactive, cached flat lookup with `{param}` interpolation
- **Locale source**: Story locale (falls back to settings locale when no story active)
- **Loader**: `LocaleStringBundle` (`src/lib/fs/locale-string-loader.ts`) with deep-merge for story overrides

### Resolution Order

1. Story override: `<story-folder>/locale-strings.yaml` (deep-merged on top of base)
2. Base file: `config/<locale>/locale-strings.yaml`
3. Bundled default (in-memory)

### Usage

```typescript
import { ls } from '$lib/localization';

ls('common.headers.worldContent'); // → "World Content"
ls('pipeline.extraction.writer', { currentScene }); // parameterized
```

## 3. Localized Prompts & View Templates

- **Source**: `src/lib/fs/prompt-loader.ts`
- **Bundled files**: `src/lib/fs/{locale}/prompts/**/*.md`, `src/lib/fs/{locale}/view-templates/*.md`
- **Runtime paths**: `config/<locale>/prompt-templates/`, `config/<locale>/view-templates/` (AppData)
- **Locale source**: `activeLocale` (set via `setActiveLocale()`, driven by story locale)

### Class Hierarchy

- `LocalizedTemplateFile` — abstract base; holds `relativePath` + locale-keyed `defaultContent`
  - `LocalizedPromptFile` — prompt templates
  - `LocalizedViewTemplateFile` — view templates

`src/lib/fs/prompts.ts` declares all instances and exports wrapper functions.

### Resolution Order

1. Story-specific: `<story-folder>/<templatesDir>/<relativePath>`
2. Base file: `config/<locale>/<templatesDir>/<relativePath>`
3. Bundled default (in-memory, locale-specific)

### Config Seeding

- `SUPPORTED_LOCALES = ['en', 'zh-Hant-HK']` — locales that get base configs on init
- `ensureAllBaseConfigs()` creates files for every supported locale x registered template
- `ensureAllLocaleStringConfigs()` creates locale-string YAML files for every supported locale

## vs i18n

|                | `lib/localization` (`ls`)                                | `lib/i18n` (`t`)                                |
|----------------|----------------------------------------------------------|-------------------------------------------------|
| **Purpose**    | LLM-facing strings (prompts, headers, labels)            | UI-facing strings (buttons, menus, dialogs)     |
| **Reactivity** | Plain function — no Svelte reactivity                    | Svelte 5 `$derived` — reactive on locale change |
| **Consumers**  | AI modules, tools, pipeline, prompt builders             | Svelte components, routes                       |
| **Overrides**  | Story-specific + base config + bundled defaults (3-tier) | Bundled JSON only                               |
| **Loaded by**  | `loadLocaleStrings(locale, storyId?, storyName?)`        | `loadLocale(locale)` / `setLocale(locale)`      |

## Directory Structure

### Bundled Defaults (`src/lib/fs/`)

```
{locale}/prompts/**/*.md
{locale}/view-templates/*.md
locale-strings/{locale}.yaml
```

### AppData Runtime

```
config/<locale>/
  prompt-templates/
  view-templates/
  locale-strings.yaml
```

## Locale Switching

| Event                   | `activeLocale`                       | `ls()` reloads                           | `t()` uses                  |
|-------------------------|--------------------------------------|------------------------------------------|-----------------------------|
| Story selected          | Story's `locale` field               | Story locale + story override            | Settings locale (unchanged) |
| Story deselected        | Settings locale                      | Settings locale                          | Settings locale             |
| Settings locale changed | Settings locale (if no story active) | New settings locale (if no story active) | New settings locale         |
| World builder entered   | Settings locale                      | Settings locale                          | Settings locale             |
