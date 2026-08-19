# Settings Dialog

Dialog-based settings experience (Open WebUI style). There are no settings
routes — the entire settings UI lives in a single dialog opened over the
current page.

## Module responsibilities

| File | Responsibility |
|---|---|
| `settings-dialog-state.svelte.ts` | Module-level `$state` for `isOpen` / `activeSection`; `openSettingsDialog(section?)` / `closeSettingsDialog()`. AI Providers (`DEFAULT_SECTION`) is the landing section. The last-visited section is remembered in memory across close/reopen. |
| `settings-sections.ts` | Declarative registry (`SETTINGS_SECTIONS`): `{ id, labelKey, descriptionKey?, icon, component, visible? }`. `getVisibleSections()` filters by `visible` (Memory is hidden unless `isMemoryCapable()`). |
| `SettingsDialog.svelte` | Dialog shell built on Skeleton's `Dialog` (portal, focus trap, Escape). Responsive: master-detail (left nav + scrollable content pane) at `md` and up; back button + horizontally scrollable pill tabs below `md`. |
| `sections/` | One component per section (General, Providers, Roles, Narrative, CharacterNames, Tts, CloudSync, Memory, Data, Developer). Each owns its own state and reuses shared UI components (`Card`, `ThemedSelect`, `NumberField`, `ProviderForm`, `RoleCallSettingsOverride`, `VoiceSelector`, `Modal`). |

## Adding a new section

1. Add the id to `SectionId` in `settings-dialog-state.svelte.ts`.
2. Create `sections/<Name>Section.svelte`.
3. Register it in `SETTINGS_SECTIONS` (label/description i18n keys, lucide icon,
   optional `visible` predicate).

## Behavior notes

- **Auto-save:** all controls write straight to the settings store; there is no
  save button anywhere (the Name Quotas editor included — it auto-applies).
- **Z-index contract:** the dialog renders at `z-50`; nested `Modal`s (`z-[70]`)
  stack above it for confirm/download dialogs.
- **Unmount on close:** the Skeleton dialog unmounts its content when closed, so
  section-local state (e.g. TTS download progress) resets on reopen.
- Entry point: the Settings button in `SidebarNav` calls `openSettingsDialog()`.
  The dialog is mounted once in `src/routes/+layout.svelte`.
