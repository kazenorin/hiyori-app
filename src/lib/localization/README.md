# localization

Locale-specific strings for **LLM input/output** — prompts, context labels, section headers, tool descriptions, and extraction instructions.

## vs `lib/i18n`

| | `lib/localization` | `lib/i18n` |
|---|---|---|
| **Purpose** | LLM-facing strings (prompts, headers, labels) | UI-facing strings (buttons, menus, dialogs) |
| **Accessor** | `ls(key, params?)` | `t(key, params?)` |
| **Reactivity** | Plain function — no Svelte reactivity | Svelte 5 `$derived` — reactive on locale change |
| **Consumers** | AI modules, tools, pipeline, prompt builders | Svelte components, routes |
| **Overrides** | Story-specific + base config + bundled defaults (3-tier) | Bundled JSON only |
| **Loaded by** | `loadLocaleStrings(locale, storyId?, storyName?)` during app init | `loadLocale(locale)` / `setLocale(locale)` on locale change |

## Usage

```typescript
import { ls } from '$lib/localization';

// Simple lookup
ls('common.headers.worldContent'); // → "World Content"

// Parameterized template
ls('pipeline.extraction.writer', { currentScene }); // → "Write a story prose for Scene {currentScene}..."
```

## Resolution order

1. `<story-folder>/locale-strings/<locale>.yaml`
2. `config/locale-strings/<locale>.yaml`
3. Bundled default (`src/lib/fs/locale-strings/<locale>.yaml`)
