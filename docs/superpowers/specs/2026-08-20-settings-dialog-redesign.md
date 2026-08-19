# Settings Page Redesign — Dialog-Based Settings with Grouped Submenus

Date: 2026-08-20
Status: Approved (design); pending implementation plan

## Goal

Replace the `/settings` route page (and its three sub-routes) with a dialog-based
settings experience modeled on Open WebUI's settings modal:

- **Desktop (≥ md):** floating master-detail dialog — left navigation pane with
  icon + label menu items, right content pane with stacked setting rows.
- **Mobile (< md):** single-column dialog — top bar with back button and a
  horizontally scrollable pill tab bar, content below.

Functionality stays the same. Auto-save is retained; no save button is added.
Icons come from `@lucide/svelte` (already a dependency).

## Decisions

- **Pure dialog, no routes.** All `src/routes/settings/**` routes are removed.
  The dialog opens over the current page; no URL state, no deep links.
- **No search bar.** ~10 menu items are all visible; search adds no value.
- **AI Providers is the landing section** (default active section when the
  dialog opens), even though "General" is the first menu item.
- **Provider Roles + Pipeline Roles merge** into one "Roles" section.
- **Inventory toggle moves into Narrative** as a feature toggle.
- **Name Quotas redesign:** "Character Names" becomes its own section. The user
  picks AI or Analytic mode inside it; when Analytic is chosen, the quota editor
  (locale select, per-culture budgets, ratios) renders inline in the same section.
  Quota changes auto-apply via `updateSettings()` — the current local draft +
  explicit Save button is removed for consistency with auto-save.
- **Last-visited section** is remembered in module memory (not localStorage).

## Architecture

New feature module `src/lib/features/settings/` (requires a `README.md` per the
project's feature-directory convention):

| File | Responsibility |
|---|---|
| `settings-dialog-state.svelte.ts` | Module-level `$state`: `isOpen`, `activeSection`; exports `openSettingsDialog(section?)` and `closeSettingsDialog()` |
| `SettingsDialog.svelte` | Dialog shell: Skeleton v4 `Dialog` primitive (`@skeletonlabs/skeleton-svelte`), nav pane, content pane, responsive layout |
| `settings-sections.ts` | Declarative registry: `{ id, labelKey, icon, component, visible? }` |
| `sections/<Name>Section.svelte` | One component per section (10 total) |

### Mounting & entry points

- `SettingsDialog` is mounted once in `src/routes/+layout.svelte`.
- `SidebarNav.svelte`: the Settings `<a href={resolve('/settings')}>` becomes a
  `<button onclick={() => openSettingsDialog()}>`.
- All former in-page links (`/settings/tts`, `/settings/cloud-sync`,
  `/settings/name-suggestion`) disappear; their content lives inside sections.

### Dialog shell

- Built on Skeleton `Dialog` (portal, focus trap, Escape handling for free).
- Desktop: centered panel, `max-w-4xl`, `h-[85vh]`, two columns. Left pane
  `~w-56`: vertical icon + label buttons; active item highlighted
  (`bg-surface-200-800` with primary text). Right pane: section title +
  description header, scrollable content.
- Mobile: panel fills most of the viewport. Top bar: back/close button far left,
  horizontally scrollable pill tab bar (icon + label), active tab highlighted.
  Content scrolls independently below.
- Settings dialog sits at `z-50`; the existing `Modal.svelte` (`z-[70]`) stacks
  above it for nested confirm/download dialogs.
- The `settings.settingsAutoSaved` notice becomes a small muted caption anchored
  at the bottom of the dialog (desktop: below the left menu; mobile: below the
  content header).

## Menu Structure

| # | Menu item | Lucide icon | Content (source) |
|---|---|---|---|
| 1 | General | `Palette` | Locale, color theme, theme mode (current Appearance card) |
| 2 | AI Providers *(landing)* | `Plug` | Provider list; add/edit/copy/delete via existing `ProviderForm` |
| 3 | Roles | `Users` | Main provider + minor task agent (internal subheader), then Plot Planner, Reviewer, Writer, Editor, Game Master, Summarizer; each keeps `RoleCallSettingsOverride` |
| 4 | Narrative | `BookOpen` | Target word count, compressor interval, director mode, phrase highlighting, phase/divergence thresholds, Inventory toggle (moved in) |
| 5 | Character Names | `Sparkles` | AI/Analytic mode select; Analytic shows inline quota editor (auto-applied) |
| 6 | Text-to-Speech | `AudioLines` | Full current `/settings/tts` content: speed slider, per-locale `VoiceSelector`, model download modal |
| 7 | Cloud Sync | `CloudUpload` | Full current `/settings/cloud-sync` content: backend config, WISP proxy, story exclusion, sync now/report |
| 8 | Memory | `Brain` | Enable + memory/embedding providers; menu item hidden unless `isMemoryCapable()` |
| 9 | Data | `Database` | Game data & config import/export, danger zone accordion |
| 10 | Developer | `Bug` | Log level |

Notes:

- The old stub cards on the main settings page (TTS summary link, Cloud Sync
  status link) are removed — full content is one menu click away.
- Memory menu item is conditionally rendered via the registry `visible?` field.

## Migration

- Section components lift markup/handlers as-is from the current `+page.svelte`
  files; existing sub-components (`ProviderForm`, `RoleCallSettingsOverride`,
  `VoiceSelector`, `ThemedSelect`, `NumberField`, `Card`, `Modal`) unchanged.
- Back buttons and `svelte:head` titles in the sub-routes are dropped.
- Delete `src/routes/settings/` entirely after migration.

## i18n

- Locales: `src/lib/i18n/locales/en.json`, `zh-Hant-HK.json` — both must be updated.
- New keys for menu labels/section titles where none exist (e.g.
  `settings.section.*`); reuse existing keys (`settings.appearance`, `tts.tts`,
  `cloudSync.title`, etc.) wherever possible.
- Removed keys (deleted routes, stub cards, Name Quotas save button) are cleaned up.

## Test Plan

Primarily UI work:

1. `svelte-check` and lint pass; existing Vitest suite passes.
2. Manual desktop check: master-detail layout, all 10 sections render, controls
   mutate settings, nested confirm modals stack above the dialog, Escape and
   backdrop click close, last section remembered on reopen.
3. Manual mobile (< md) check: pill tab bar scrolls horizontally, back button
   closes, content scrolls independently.
4. Web build (non-Tauri): Memory menu item hidden.
