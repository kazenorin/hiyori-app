# Settings Dialog Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/settings` route pages with a single dialog-based settings experience (Open WebUI style: master-detail on desktop, pill tab bar on mobile), keeping all functionality and auto-save behavior.

**Architecture:** A `SettingsDialog` mounted once in the root layout, driven by module-level state (`settings-dialog-state.svelte.ts`) and a declarative section registry (`settings-sections.ts`). Each former page section becomes a standalone section component under `src/lib/features/settings/sections/`. The dialog shell uses Skeleton v5's `Dialog` (zag-based) from `@skeletonlabs/skeleton-svelte`.

**Tech Stack:** Svelte 5 (runes), SvelteKit, Skeleton v5 (`Dialog`), `@lucide/svelte` icons, Tailwind utilities, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-20-settings-dialog-redesign.md`

**Working branch:** `feature/settings-redesign` (already checked out).

**Conventions to follow:**

- LF line endings + trailing newline on new files (Prettier).
- Minimal comments — only intent/reasoning that isn't obvious from code.
- Tests use explicit `it()` blocks (no `it.each`).
- Conventional commit messages (`feat:`, `test:`, `chore:`, ...).
- Never hardcode colors — use Skeleton/Tailwind theme tokens.

---

### Task 1: Dialog state module (TDD)

**Files:**

- Create: `src/lib/features/settings/settings-dialog-state.svelte.ts`
- Test: `src/lib/__tests__/features/settings/settings-dialog-state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/features/settings/settings-dialog-state.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
	openSettingsDialog,
	closeSettingsDialog,
	isSettingsDialogOpen,
	getActiveSection,
	setActiveSection,
	DEFAULT_SECTION,
} from '$lib/features/settings/settings-dialog-state.svelte';

describe('settings-dialog-state', () => {
	beforeEach(() => {
		closeSettingsDialog();
		setActiveSection(DEFAULT_SECTION);
	});

	it('starts closed', () => {
		expect(isSettingsDialogOpen()).toBe(false);
	});

	it('opens on the AI Providers landing section by default', () => {
		openSettingsDialog();
		expect(isSettingsDialogOpen()).toBe(true);
		expect(getActiveSection()).toBe('providers');
	});

	it('opens a specific section when requested', () => {
		openSettingsDialog('tts');
		expect(isSettingsDialogOpen()).toBe(true);
		expect(getActiveSection()).toBe('tts');
	});

	it('remembers the last-visited section across close/reopen', () => {
		openSettingsDialog();
		setActiveSection('data');
		closeSettingsDialog();
		openSettingsDialog();
		expect(getActiveSection()).toBe('data');
	});

	it('closes without resetting the active section', () => {
		openSettingsDialog('cloudSync');
		closeSettingsDialog();
		expect(isSettingsDialogOpen()).toBe(false);
		expect(getActiveSection()).toBe('cloudSync');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/features/settings/settings-dialog-state.test.ts`
Expected: FAIL — module `$lib/features/settings/settings-dialog-state.svelte` cannot be resolved.

- [ ] **Step 3: Implement the module**

```ts
// src/lib/features/settings/settings-dialog-state.svelte.ts
export type SectionId =
	'general' | 'providers' | 'roles' | 'narrative' | 'characterNames' | 'tts' | 'cloudSync' | 'memory' | 'data' | 'developer';

// AI Providers is the landing section: it's the most important setting
// (nothing works without a provider), even though General lists first.
export const DEFAULT_SECTION: SectionId = 'providers';

let isOpen = $state(false);
let activeSection = $state<SectionId>(DEFAULT_SECTION);

export function openSettingsDialog(section?: SectionId): void {
	if (section) activeSection = section;
	isOpen = true;
}

export function closeSettingsDialog(): void {
	isOpen = false;
}

export function isSettingsDialogOpen(): boolean {
	return isOpen;
}

export function getActiveSection(): SectionId {
	return activeSection;
}

export function setActiveSection(section: SectionId): void {
	activeSection = section;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/features/settings/settings-dialog-state.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/features/settings/settings-dialog-state.svelte.ts src/lib/__tests__/features/settings/settings-dialog-state.test.ts
git commit -m "feat(settings): add dialog open/section state module"
```

---

### Task 2: i18n keys for new menu labels

**Files:**

- Modify: `src/lib/i18n/locales/en.json`
- Modify: `src/lib/i18n/locales/zh-Hant-HK.json`

The locale files are nested JSON; `t('settings.section.general')` resolves through nested objects. Most section labels reuse existing keys (`settings.aiProviders`, `settings.narrative`, `settings.memory`, `settings.data`, `settings.developer`, `tts.tts`, `cloudSync.title`). Only three new keys are needed.

- [ ] **Step 1: Add keys to `en.json`**

Inside the top-level `"settings"` object, add a `"section"` block (place it near the existing `"heading"` key):

```json
"section": {
	"general": "General",
	"roles": "Roles",
	"characterNames": "Character Names"
},
```

- [ ] **Step 2: Add keys to `zh-Hant-HK.json`**

Same location inside the `"settings"` object:

```json
"section": {
	"general": "一般",
	"roles": "角色分工",
	"characterNames": "角色名稱"
},
```

- [ ] **Step 3: Verify JSON validity**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/lib/i18n/locales/en.json','utf8')); JSON.parse(require('fs').readFileSync('src/lib/i18n/locales/zh-Hant-HK.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```powershell
git add src/lib/i18n/locales/en.json src/lib/i18n/locales/zh-Hant-HK.json
git commit -m "feat(settings): add i18n keys for dialog section labels"
```

---

### Task 3: Simple sections (General, Developer, Memory)

Establish the section component pattern with the three smallest sections. All content is lifted verbatim from `src/routes/settings/+page.svelte` — only the wrapping `Card` context changes; markup and classes stay identical.

**Files:**

- Create: `src/lib/features/settings/sections/GeneralSection.svelte`
- Create: `src/lib/features/settings/sections/DeveloperSection.svelte`
- Create: `src/lib/features/settings/sections/MemorySection.svelte`

- [ ] **Step 1: `GeneralSection.svelte`**

Lift the Appearance card body from `src/routes/settings/+page.svelte` (the `<!-- Appearance -->` Card, currently lines ~197-217): the locale select block and the colorTheme/themeMode grid. Wrap in `<Card title={t('settings.appearance')} description={t('settings.appearanceDescription')}>`.

```svelte
<script lang="ts">
	import { settings, updateSettings, type ThemeMode } from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { getLocaleItems, getThemeModeItems, getColorThemeItems } from '$lib/features/settings-options';

	const localeItems = $derived(getLocaleItems());
	const themeModeItems = $derived(getThemeModeItems());
	const colorThemeItems = $derived(getColorThemeItems());
</script>

<Card title={t('settings.appearance')} description={t('settings.appearanceDescription')}>
	<!-- copy the three inner blocks (locale, colorTheme/themeMode grid) verbatim
	     from the current Appearance card in src/routes/settings/+page.svelte -->
</Card>
```

- [ ] **Step 2: `DeveloperSection.svelte`**

Lift the Developer card (currently lines ~781-787) verbatim:

```svelte
<script lang="ts">
	import { settings, updateSettings, type LogLevel } from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { getLogLevelItems } from '$lib/features/settings-options';

	const logLevelItems = $derived(getLogLevelItems());
</script>

<Card title={t('settings.developer')}>
	<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
		<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.logLevel')}</h3>
		<ThemedSelect items={logLevelItems} value={settings.logLevel} onValueChange={(v) => updateSettings({ logLevel: v as LogLevel })} />
		<span class="text-xs text-surface-500 block">{t('settings.logLevelDescription')}</span>
	</div>
</Card>
```

- [ ] **Step 3: `MemorySection.svelte`**

Lift the Memory card inner content (currently lines ~727-765: enable checkbox, memoryProvider select, embeddingProvider select, each with `RoleCallSettingsOverride`) into:

```svelte
<script lang="ts">
	import { settings, updateSettings } from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import RoleCallSettingsOverride from '$lib/components/chat/RoleCallSettingsOverride.svelte';
	import { getRoleItems } from '$lib/features/settings-options';
	import { isMemoryAvailable, isMemoryCapable } from '$lib/stores/settings.svelte';
</script>

<Card title={t('settings.memory')} description={t('settings.enableMemoryDescription')}>
	<!-- copy the enable checkbox, memory provider block, and embedding provider
	     block verbatim from the current Memory card -->
</Card>
```

Note: the registry (Task 11) hides this section unless `isMemoryCapable()`, so no inner conditional is needed — but keep the `disabled={!isMemoryCapable()}` on the checkbox as in the original.

- [ ] **Step 4: Verify**

Run: `npm run check`
Expected: 0 errors (unused-import warnings in the old route page are fine for now).

- [ ] **Step 5: Commit**

```powershell
git add src/lib/features/settings/sections/
git commit -m "feat(settings): add General, Developer and Memory dialog sections"
```

---

### Task 4: Narrative section (+ Inventory toggle move)

**Files:**

- Create: `src/lib/features/settings/sections/NarrativeSection.svelte`

- [ ] **Step 1: Create the section**

Lift the entire Narrative card body from `src/routes/settings/+page.svelte` (currently lines ~313-430): word count/compressor grid, director mode/phrase highlighting grid, phase/divergence thresholds grid. Two changes vs the original:

1. **Delete the Character Name Engine block** (currently lines ~376-399) — it moves to the Character Names section (Task 7).
2. **Append the Inventory toggle** as a final card, lifted from the current standalone Inventory card (lines ~768-778).

```svelte
<script lang="ts">
	import { getMinorTaskAgentProviderConfig, settings, updateSettings } from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import NumberField from '$lib/components/ui/NumberField.svelte';
</script>

<div class="space-y-4">
	<Card title={t('settings.narrative')}>
		<!-- word count + compressor interval grid (verbatim) -->
		<!-- director mode + phrase highlighting grid (verbatim) -->
		<!-- phase advancement + player divergence thresholds grid (verbatim) -->
	</Card>

	<Card title={t('settings.inventory')} description={t('settings.enableInventoryDescription')}>
		<label class="flex items-center gap-2">
			<input
				type="checkbox"
				class="checkbox"
				checked={settings.inventoryEnabled}
				onchange={(e) => updateSettings({ inventoryEnabled: (e.currentTarget as HTMLInputElement).checked })}
			/>
			<span class="text-sm font-medium text-surface-700-300">{t('settings.enableInventory')}</span>
		</label>
	</Card>
</div>
```

- [ ] **Step 2: Verify** — Run: `npm run check` — Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/features/settings/sections/NarrativeSection.svelte
git commit -m "feat(settings): add Narrative dialog section with inventory toggle"
```

---

### Task 5: AI Providers section

**Files:**

- Create: `src/lib/features/settings/sections/ProvidersSection.svelte`

- [ ] **Step 1: Create the section**

Lift from `src/routes/settings/+page.svelte`:

- All provider editing state and handlers (lines ~53-54, 122-175): `editingId`, `isAddingNew`, `startEdit`, `startAdd`, `cancelEdit`, `handleSaveFromForm`, `handleSaveNewFromForm`, `handleDelete`, `handleDuplicate`, `isEditing`, `mainProviderId`.
- The AI Providers card markup (lines ~220-279): header with Add Provider button, empty state, provider list with edit/copy/delete, `ProviderForm` for edit/add.

Wrap in a plain `<Card>` exactly as the original (the original uses `<Card>` without title; the section title comes from the dialog header instead — keep the "Add Provider" button row inside).

```svelte
<script lang="ts">
	import {
		addProviderConfig,
		assignRole,
		deleteProviderConfig,
		settings,
		updateProviderConfig,
		type ProviderConfig,
	} from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import ProviderForm from '$lib/components/chat/ProviderForm.svelte';

	// copy editing state + handlers verbatim from the current +page.svelte
	// (editingId, isAddingNew, startEdit, startAdd, cancelEdit,
	//  handleSaveFromForm, handleSaveNewFromForm, handleDelete,
	//  handleDuplicate, isEditing, mainProviderId)
</script>

<Card>
	<!-- copy the provider list markup verbatim: header row with Add Provider
	     button, empty-state text, {#each settings.providers} block with
	     ProviderForm / provider row, and the {#if isAddingNew} form -->
</Card>
```

- [ ] **Step 2: Verify** — Run: `npm run check` — Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/features/settings/sections/ProvidersSection.svelte
git commit -m "feat(settings): add AI Providers dialog section"
```

---

### Task 6: Roles section (merge Provider Roles + Pipeline Roles)

**Files:**

- Create: `src/lib/features/settings/sections/RolesSection.svelte`

- [ ] **Step 1: Create the section**

Merge two current cards from `src/routes/settings/+page.svelte` into one section with two cards:

1. `<Card title={t('settings.providerRoles')} description={t('settings.providerRolesDescription')}>` — lift the Main Provider + Minor Task Agent grid verbatim (lines ~283-309).
2. `<Card title={t('settings.pipelineRoles')} description={t('settings.pipelineRolesDescription')}>` — lift the Plot Planner block, Reviewer block, and the 2×2 Writer/Editor/Game Master/Summarizer grid verbatim (lines ~434-589).

```svelte
<script lang="ts">
	import { assignRole, settings, updateSettings } from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import RoleCallSettingsOverride from '$lib/components/chat/RoleCallSettingsOverride.svelte';
	import { getRoleItems, getReviewerModeItems } from '$lib/features/settings-options';

	const mainProviderId = $derived(settings.roleAssignments['main']);
	const reviewerModeItems = $derived(getReviewerModeItems());
</script>

<div class="space-y-4">
	<Card title={t('settings.providerRoles')} description={t('settings.providerRolesDescription')}>
		<!-- main provider + minor task agent grid (verbatim) -->
	</Card>

	<Card title={t('settings.pipelineRoles')} description={t('settings.pipelineRolesDescription')}>
		<!-- plot planner block, reviewer block, 2x2 grid (verbatim) -->
	</Card>
</div>
```

- [ ] **Step 2: Verify** — Run: `npm run check` — Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/features/settings/sections/RolesSection.svelte
git commit -m "feat(settings): add merged Roles dialog section"
```

---

### Task 7: Character Names section (redesign, auto-apply)

**Files:**

- Create: `src/lib/features/settings/sections/CharacterNamesSection.svelte`

Redesign per spec: one section combining the mode select (from the old Narrative block) and the quota editor (from the old `/settings/name-suggestion` page). Quota changes auto-apply via `updateSettings()` — the old local draft + Save button is removed.

- [ ] **Step 1: Create the section**

```svelte
<script lang="ts">
	import { getNameSuggestionQuotas, settings, updateSettings } from '$lib/stores/settings.svelte';
	import { DEFAULT_NAME_QUOTAS, type NameQuotaConfig } from '$lib/features/name-suggestion/quota';
	import { getNameDataset, getNameDatasetPool } from '$lib/features/name-suggestion/dataset';
	import { CULTURE_META, CULTURES, type Culture } from '$lib/features/name-suggestion/types';
	import { SUPPORTED_LOCALES } from '$lib/fs/prompt-loader';
	import { getLocaleItems } from '$lib/features/settings-options';
	import { t } from '$lib/i18n';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import NumberField from '$lib/components/ui/NumberField.svelte';
	import Card from '$lib/components/ui/Card.svelte';

	function cloneQuotas(q: NameQuotaConfig): NameQuotaConfig {
		return {
			budgets: Object.fromEntries(Object.entries(q.budgets).map(([locale, budgets]) => [locale, { ...budgets }])),
			ratio: { ...q.ratio },
		};
	}

	// Auto-apply: write a mutated clone straight to settings (no draft/save).
	function updateQuotas(mutate: (q: NameQuotaConfig) => void): void {
		const next = cloneQuotas(getNameSuggestionQuotas());
		mutate(next);
		void updateSettings({ nameSuggestionQuotas: next });
	}

	const localeItems = getLocaleItems();

	let selectedLocale = $state((SUPPORTED_LOCALES as readonly string[]).includes(settings.locale) ? settings.locale : 'en');
	let counts = $state<Record<string, { active: number; total: number }> | null>(null);

	function budgetFor(locale: string, culture: Culture): number {
		const q = getNameSuggestionQuotas();
		return q.budgets[locale]?.[culture] ?? DEFAULT_NAME_QUOTAS.budgets[locale]?.[culture] ?? 0;
	}

	function setBudget(culture: Culture, value: number): void {
		updateQuotas((q) => {
			if (!q.budgets[selectedLocale]) q.budgets[selectedLocale] = {};
			q.budgets[selectedLocale]![culture] = value;
		});
	}

	function setRatio(key: 'given' | 'family' | 'nickname', value: number): void {
		updateQuotas((q) => {
			q.ratio[key] = value;
		});
	}

	async function refreshCounts(locale: string): Promise<void> {
		const [pool, active] = await Promise.all([getNameDatasetPool(locale), getNameDataset(locale, () => 0.5)]);
		if (locale !== selectedLocale) return;
		const next: Record<string, { active: number; total: number }> = {};
		for (const culture of CULTURES) {
			next[culture] = {
				active: active.filter((e) => e.cultures.includes(culture)).length,
				total: pool.filter((e) => e.cultures.includes(culture)).length,
			};
		}
		counts = next;
	}

	$effect(() => {
		if (settings.characterNameSuggestionMode === 'analytic') {
			void refreshCounts(selectedLocale);
		}
	});
</script>

<div class="space-y-4">
	<Card title={t('settings.characterNameEngine')}>
		<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
			<div class="flex items-center gap-2">
				<span class="text-xs font-medium text-surface-500">{t('settings.characterNameEngineMode')}</span>
				<ThemedSelect
					items={[
						{ label: t('settings.characterNameEngineAi'), value: 'ai' },
						{ label: t('settings.characterNameEngineAnalytic'), value: 'analytic' },
					]}
					value={settings.characterNameSuggestionMode}
					onValueChange={(v) => updateSettings({ characterNameSuggestionMode: v as 'ai' | 'analytic' })}
				/>
			</div>
			<span class="text-xs text-surface-500 block"
				>{settings.characterNameSuggestionMode === 'ai'
					? t('settings.characterNameEngineAiDescription')
					: t('settings.characterNameEngineAnalyticDescription')}</span
			>
		</div>
	</Card>

	{#if settings.characterNameSuggestionMode === 'analytic'}
		<Card title={t('settings.nameQuotas.localeSection')}>
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<ThemedSelect items={localeItems} value={selectedLocale} onValueChange={(v) => (selectedLocale = v)} />
			</div>
		</Card>

		<Card title={t('settings.nameQuotas.budgetsSection')} description={t('settings.nameQuotas.budgetsDescription')}>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				{#each CULTURES as culture (culture)}
					<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-2">
						<NumberField
							label={t(`settings.nameQuotas.cultures.${culture}`)}
							hint={counts
								? t('settings.nameQuotas.activeCount', {
										active: counts[culture]?.active ?? 0,
										total: counts[culture]?.total ?? 0,
									})
								: undefined}
							min={0}
							max={1000}
							step={5}
							value={budgetFor(selectedLocale, culture)}
							onValueChange={(v) => {
								if (v >= 0 && v <= 1000) setBudget(culture, v);
							}}
						/>
						{#if CULTURE_META[culture].nameOrder === 'noFamily'}
							<span class="text-xs text-surface-500 block">{t('settings.nameQuotas.noFamilyHint')}</span>
						{/if}
					</div>
				{/each}
			</div>
		</Card>

		<Card title={t('settings.nameQuotas.ratioSection')} description={t('settings.nameQuotas.ratioDescription')}>
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4">
					<NumberField
						label={t('settings.nameQuotas.ratioGiven')}
						min={0}
						max={100}
						step={5}
						value={getNameSuggestionQuotas().ratio.given}
						onValueChange={(v) => {
							if (v >= 0 && v <= 100) setRatio('given', v);
						}}
					/>
				</div>
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4">
					<NumberField
						label={t('settings.nameQuotas.ratioFamily')}
						min={0}
						max={100}
						step={5}
						value={getNameSuggestionQuotas().ratio.family}
						onValueChange={(v) => {
							if (v >= 0 && v <= 100) setRatio('family', v);
						}}
					/>
				</div>
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4">
					<NumberField
						label={t('settings.nameQuotas.ratioNickname')}
						min={0}
						max={100}
						step={5}
						value={getNameSuggestionQuotas().ratio.nickname}
						onValueChange={(v) => {
							if (v >= 0 && v <= 100) setRatio('nickname', v);
						}}
					/>
				</div>
			</div>
		</Card>
	{/if}
</div>
```

- [ ] **Step 2: Verify** — Run: `npm run check` — Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/features/settings/sections/CharacterNamesSection.svelte
git commit -m "feat(settings): add Character Names section with inline auto-applied quotas"
```

---

### Task 8: Text-to-Speech section (lift)

**Files:**

- Create: `src/lib/features/settings/sections/TtsSection.svelte`

- [ ] **Step 1: Create the section**

Copy `src/routes/settings/tts/+page.svelte` script + markup with these removals:

- Remove `goto` / `resolve` imports and `handleBack()`.
- Remove the `<svelte:head>` block.
- Remove the back button and the `h1`/description header block (the dialog header shows the title).
- Remove the outer `flex-1 overflow-y-auto p-...` / `max-w-2xl mx-auto` wrappers — keep the inner `space-y-6` div.

Keep everything else verbatim: the speed card, per-locale `VoiceSelector` cards, all download state/handlers, and the download `Modal`. Wrap the result in `<div class="space-y-4">` (replace `space-y-6` to match other sections).

- [ ] **Step 2: Verify** — Run: `npm run check` — Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/features/settings/sections/TtsSection.svelte
git commit -m "feat(settings): add Text-to-Speech dialog section"
```

---

### Task 9: Cloud Sync section (lift)

**Files:**

- Create: `src/lib/features/settings/sections/CloudSyncSection.svelte`

- [ ] **Step 1: Create the section**

Copy `src/routes/settings/cloud-sync/+page.svelte` script + markup with these removals:

- Remove `goto` / `resolve` imports and `handleBack()`.
- Remove the `<svelte:head>` block.
- Remove the back button and the `h1`/description header block.
- Remove the outer scroll/max-width wrappers; keep the inner `space-y-6` content, wrapped in `<div class="space-y-4">`.

Keep everything else verbatim: enable/backend card, S3 and WebDAV config cards, WISP proxy card, story exclusion card, sync now card with status/report.

- [ ] **Step 2: Verify** — Run: `npm run check` — Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/features/settings/sections/CloudSyncSection.svelte
git commit -m "feat(settings): add Cloud Sync dialog section"
```

---

### Task 10: Data section (lift, includes confirm modals)

**Files:**

- Create: `src/lib/features/settings/sections/DataSection.svelte`

- [ ] **Step 1: Create the section**

Lift from `src/routes/settings/+page.svelte`:

- All data import/export state and handlers (lines ~56-120): `gameIO`, `configIO`, `exportProgress`, `isImporting`, the eight `handle*` functions, `handleResetConfirm`, `handleDeleteAllGameDataConfirm`, `showResetConfirm`, `isResetting`, `showDeleteAllGameDataConfirm`, `isDeletingAllGameData`.
- The Data card markup (lines ~593-699): web notice, game data + config export/import grids, danger zone accordion.
- The four confirm `Modal`s (import game data, import config, reset configuration, delete all game data — lines ~791-887) and the importing spinner overlay (lines ~889-896).

Structure:

```svelte
<script lang="ts">
	// copy state + handlers verbatim (see list above); imports:
	// settings.svelte (resetConfiguration), stories.svelte (deleteStory, getStories),
	// db/app-state, db/database, data-portability, data-import-export feature,
	// prompt-loader (ensureAllBaseConfigs), runtime (isTauriSync),
	// t, Modal, ProgressField, Spinner, Card
</script>

<Card title={t('settings.data')} description={t('settings.dataDescription')}>
	<!-- web notice, export/import grids, danger zone accordion (verbatim) -->
</Card>

<!-- the four confirm Modals and the importing overlay, verbatim -->
```

Note: the nested `Modal`s render at `z-[70]` and stack above the settings dialog (`z-50`) — no changes needed to `Modal.svelte`.

- [ ] **Step 2: Verify** — Run: `npm run check` — Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/features/settings/sections/DataSection.svelte
git commit -m "feat(settings): add Data dialog section with danger zone"
```

---

### Task 11: Section registry

**Files:**

- Create: `src/lib/features/settings/settings-sections.ts`

- [ ] **Step 1: Create the registry**

```ts
// src/lib/features/settings/settings-sections.ts
import type { Component } from 'svelte';
import { Palette, Plug, Users, BookOpen, Sparkles, AudioLines, CloudUpload, Brain, Database, Bug } from '@lucide/svelte';
import type { SectionId } from './settings-dialog-state.svelte';
import { isMemoryCapable } from '$lib/stores/settings.svelte';
import GeneralSection from './sections/GeneralSection.svelte';
import ProvidersSection from './sections/ProvidersSection.svelte';
import RolesSection from './sections/RolesSection.svelte';
import NarrativeSection from './sections/NarrativeSection.svelte';
import CharacterNamesSection from './sections/CharacterNamesSection.svelte';
import TtsSection from './sections/TtsSection.svelte';
import CloudSyncSection from './sections/CloudSyncSection.svelte';
import MemorySection from './sections/MemorySection.svelte';
import DataSection from './sections/DataSection.svelte';
import DeveloperSection from './sections/DeveloperSection.svelte';

export interface SettingsSection {
	id: SectionId;
	labelKey: string;
	descriptionKey?: string;
	icon: Component;
	component: Component;
	visible?: () => boolean;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
	{
		id: 'general',
		labelKey: 'settings.section.general',
		descriptionKey: 'settings.appearanceDescription',
		icon: Palette,
		component: GeneralSection,
	},
	{ id: 'providers', labelKey: 'settings.aiProviders', icon: Plug, component: ProvidersSection },
	{
		id: 'roles',
		labelKey: 'settings.section.roles',
		descriptionKey: 'settings.providerRolesDescription',
		icon: Users,
		component: RolesSection,
	},
	{ id: 'narrative', labelKey: 'settings.narrative', icon: BookOpen, component: NarrativeSection },
	{ id: 'characterNames', labelKey: 'settings.section.characterNames', icon: Sparkles, component: CharacterNamesSection },
	{ id: 'tts', labelKey: 'tts.tts', descriptionKey: 'tts.ttsDescription', icon: AudioLines, component: TtsSection },
	{ id: 'cloudSync', labelKey: 'cloudSync.title', descriptionKey: 'cloudSync.description', icon: CloudUpload, component: CloudSyncSection },
	{
		id: 'memory',
		labelKey: 'settings.memory',
		descriptionKey: 'settings.enableMemoryDescription',
		icon: Brain,
		component: MemorySection,
		visible: () => isMemoryCapable(),
	},
	{ id: 'data', labelKey: 'settings.data', descriptionKey: 'settings.dataDescription', icon: Database, component: DataSection },
	{ id: 'developer', labelKey: 'settings.developer', icon: Bug, component: DeveloperSection },
];

export function getVisibleSections(): SettingsSection[] {
	return SETTINGS_SECTIONS.filter((s) => !s.visible || s.visible());
}
```

- [ ] **Step 2: Verify** — Run: `npm run check` — Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/features/settings/settings-sections.ts
git commit -m "feat(settings): add declarative section registry"
```

---

### Task 12: Dialog shell

**Files:**

- Create: `src/lib/features/settings/SettingsDialog.svelte`

Skeleton v5 `Dialog` anatomy (zag-based): `Dialog.Root` accepts `open` + `onOpenChange` (details `{ open: boolean }`); `Dialog.Backdrop`, `Dialog.Positioner`, `Dialog.Content`, `Dialog.Title`, `Dialog.Description` provide the structure, portal, focus trap, and Escape handling.

- [ ] **Step 1: Create the shell**

```svelte
<script lang="ts">
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { ArrowLeft, X } from '@lucide/svelte';
	import { t } from '$lib/i18n';
	import {
		closeSettingsDialog,
		getActiveSection,
		isSettingsDialogOpen,
		setActiveSection,
		type SectionId,
	} from './settings-dialog-state.svelte';
	import { getVisibleSections } from './settings-sections';

	const sections = $derived(getVisibleSections());
	const active = $derived(sections.find((s) => s.id === getActiveSection()) ?? sections[0]);

	function handleOpenChange(details: { open: boolean }): void {
		if (!details.open) closeSettingsDialog();
	}

	function select(id: SectionId): void {
		setActiveSection(id);
	}
</script>

<Dialog.Root open={isSettingsDialogOpen()} onOpenChange={handleOpenChange}>
	<Dialog.Backdrop class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
	<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-4">
		<Dialog.Content
			class="bg-surface-50-950 border border-surface-200-800 rounded-xl shadow-2xl w-[95vw] max-w-4xl h-[90dvh] md:h-[85dvh] flex flex-col overflow-hidden outline-none"
		>
			<!-- Mobile top bar: back button + horizontally scrollable pill tabs -->
			<div class="md:hidden flex items-center gap-2 p-2 border-b border-surface-200-800 shrink-0">
				<button
					class="btn btn-sm preset-tonal shrink-0 min-h-11 px-2"
					type="button"
					aria-label={t('settings.back')}
					onclick={closeSettingsDialog}
				>
					<ArrowLeft size={18} />
				</button>
				<div class="flex items-center gap-1 overflow-x-auto whitespace-nowrap">
					{#each sections as section (section.id)}
						<button
							class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm shrink-0 transition-colors {section.id === active?.id
								? 'bg-primary-500 text-white'
								: 'text-surface-500 hover:bg-surface-200-800'}"
							type="button"
							onclick={() => select(section.id)}
						>
							<section.icon size={16} />
							{t(section.labelKey)}
						</button>
					{/each}
				</div>
			</div>

			<div class="flex flex-1 min-h-0">
				<!-- Desktop left navigation -->
				<nav class="hidden md:flex flex-col w-56 shrink-0 border-r border-surface-200-800 p-3 gap-1 overflow-y-auto">
					{#each sections as section (section.id)}
						<button
							class="flex items-center gap-2 px-3 py-2 rounded-(--radius-base) text-sm text-left transition-colors {section.id ===
							active?.id
								? 'bg-surface-200-800 text-primary-600-400 font-medium'
								: 'text-surface-500 hover:bg-surface-200-800'}"
							type="button"
							onclick={() => select(section.id)}
						>
							<section.icon size={16} class="shrink-0" />
							{t(section.labelKey)}
						</button>
					{/each}
					<p class="mt-auto px-3 pt-3 text-xs text-surface-500">{t('settings.settingsAutoSaved')}</p>
				</nav>

				<!-- Right content pane -->
				<div class="flex-1 flex flex-col min-w-0">
					<header class="flex items-start justify-between gap-4 p-4 border-b border-surface-200-800 shrink-0">
						<div>
							<Dialog.Title class="h4 font-display">{active ? t(active.labelKey) : ''}</Dialog.Title>
							{#if active?.descriptionKey}
								<Dialog.Description class="text-sm text-surface-500 mt-1">{t(active.descriptionKey)}</Dialog.Description>
							{/if}
						</div>
						<button class="hidden md:inline-flex btn btn-sm preset-tonal shrink-0" type="button" onclick={closeSettingsDialog}>
							<X size={16} />
						</button>
					</header>
					<p class="md:hidden px-4 pt-3 text-xs text-surface-500">{t('settings.settingsAutoSaved')}</p>
					<div class="flex-1 overflow-y-auto p-4 md:p-6">
						{#if active}
							{@const Section = active.component}
							<Section />
						{/if}
					</div>
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Positioner>
</Dialog.Root>
```

- [ ] **Step 2: Verify** — Run: `npm run check` — Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/features/settings/SettingsDialog.svelte
git commit -m "feat(settings): add responsive dialog shell"
```

---

### Task 13: Mount dialog and rewire entry points

**Files:**

- Modify: `src/routes/+layout.svelte`
- Modify: `src/lib/components/chat/SidebarNav.svelte`

- [ ] **Step 1: Mount in `+layout.svelte`**

Add the import next to the other feature imports:

```ts
import SettingsDialog from '$lib/features/settings/SettingsDialog.svelte';
```

Add the element next to the other app-wide overlays (after `<CloudSyncOverlay />`, before the `Toast.Group`):

```svelte
<!-- Settings Dialog -->
<SettingsDialog />
```

- [ ] **Step 2: Rewire `SidebarNav.svelte`**

Replace the Settings anchor (lines ~409-414):

```svelte
<a
	href={resolve('/settings')}
	class="flex items-center gap-2 p-2 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500"
>
	{t('sidebar.settings')}
</a>
```

with a button that opens the dialog:

```svelte
<button
	class="flex items-center gap-2 p-2 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500 w-full text-left cursor-pointer"
	type="button"
	onclick={() => openSettingsDialog()}
>
	{t('sidebar.settings')}
</button>
```

Add the import:

```ts
import { openSettingsDialog } from '$lib/features/settings/settings-dialog-state.svelte';
```

If `resolve` becomes unused in this file after the change, remove its import (check other usages first — the Chat anchor still uses it).

- [ ] **Step 3: Verify** — Run: `npm run check` — Expected: 0 errors.

- [ ] **Step 4: Commit**

```powershell
git add src/routes/+layout.svelte src/lib/components/chat/SidebarNav.svelte
git commit -m "feat(settings): mount settings dialog and open it from sidebar"
```

---

### Task 14: Delete old routes and clean up i18n

**Files:**

- Delete: `src/routes/settings/+page.svelte`
- Delete: `src/routes/settings/tts/+page.svelte`
- Delete: `src/routes/settings/cloud-sync/+page.svelte`
- Delete: `src/routes/settings/name-suggestion/+page.svelte`
- Modify: `src/lib/i18n/locales/en.json`
- Modify: `src/lib/i18n/locales/zh-Hant-HK.json`

- [ ] **Step 1: Delete the routes**

Delete the four files above (the whole `src/routes/settings/` tree). Use the DeleteFile tool per file, or `git rm -r src/routes/settings`.

- [ ] **Step 2: Find leftover references**

Run: `rg "'/settings|/settings/" src/`
Expected: no matches in code (only docs/README references, which are fine).

- [ ] **Step 3: Clean up unused i18n keys**

For each candidate key below, run `rg "<key-fragment>" src/` and delete the key from **both** locale files only if no code references remain:

- `settings.ttsConfig.title`, `settings.ttsConfig.description` (dialog header replaces them; keep `settings.ttsConfig.locale.*`)
- `settings.nameQuotas.save` (Save button removed)
- `settings.back` (back buttons removed — verify no other page uses it first)
- `settings.heading`, `settings.settingsAutoSaved` stays (still used by the dialog caption)
- `settings.characterNameEngineConfigure` (link removed)
- `settings.inventory`, `settings.enableInventory`, `settings.enableInventoryDescription` stay (used in NarrativeSection)

After edits verify JSON validity as in Task 2 Step 3.

- [ ] **Step 4: Full verification**

Run: `npm run check` then `npm run lint` then `npm test`
Expected: all pass with 0 errors.

- [ ] **Step 5: Commit**

```powershell
git add -A src/routes/settings src/lib/i18n/locales/
git commit -m "refactor(settings): remove settings routes and unused i18n keys"
```

---

### Task 15: Feature README

**Files:**

- Create: `src/lib/features/settings/README.md`

- [ ] **Step 1: Write the README**

Cover: purpose (dialog-based settings, no routes), module responsibilities
(`settings-dialog-state.svelte.ts`, `settings-sections.ts`, `SettingsDialog.svelte`,
`sections/`), how to add a new section (add `SectionId`, create component,
register in `SETTINGS_SECTIONS`), responsive behavior (md breakpoint: desktop
master-detail vs mobile pill tabs), z-index contract (dialog z-50, nested
`Modal` z-[70] stacks above), and the auto-save policy (no save buttons;
quota editor included).

- [ ] **Step 2: Commit**

```powershell
git add src/lib/features/settings/README.md
git commit -m "docs(settings): add settings feature README"
```

---

### Task 16: Final verification & formatting

- [ ] **Step 1: Format new files**

Run: `npm run format:check` — if it reports the new files, run `npm run format` on them only (e.g. `npx prettier --write src/lib/features/settings/`), then re-run check/lint/test.

- [ ] **Step 2: Full suite**

Run: `npm run check; npm run lint; npm test`
Expected: all green.

- [ ] **Step 3: Manual verification checklist**

Start the dev server (`npm run dev`) and verify:

1. Desktop: sidebar Settings button opens the dialog; master-detail layout; AI Providers is the active landing section though General is first in the menu.
2. All 10 sections render; change one setting in several sections and reload — values persist (auto-save).
3. Memory section hidden in the web dev build (non-Tauri).
4. Nested confirm modals (Data danger zone, TTS model download) render above the dialog.
5. Escape key and backdrop click close the dialog; reopening returns to the last-visited section.
6. Mobile viewport (< 768px): pill tab bar scrolls horizontally, back button closes, content scrolls independently.
7. Character Names: switching to Analytic shows the quota editor; budget/ratio changes persist immediately without a Save button.

- [ ] **Step 4: Final commit (if formatting changed anything)**

```powershell
git add -A
git commit -m "chore(settings): format settings dialog files"
```
