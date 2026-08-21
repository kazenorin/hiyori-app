# GM Phase Prompt Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the fs-based `game-master-prompt.md` into a lean system prompt (role declaration + rules) plus per-plot-mode extraction prompts (`guidance-game-master-extraction-prompt.md`, `phase-event-game-master-extraction-prompt.md`), template the inventory tool instruction into the extraction prompt instead of appending a locale string, and wire plot-mode-based selection inside `executeGmPhase()` (`src/lib/ai/pipeline/runners.ts:534-548`).

**Architecture:** Mirror the writer phase's existing fs-based guidance/phase-event extraction pattern. Two new `PromptLoader` instances feed two new fields on `PipelinePrompts` (`guidanceGameMasterExtractionPrompt`, `phaseEventGameMasterExtractionPrompt`). `resolveGmExtractionPrompt(ctx)` selects the variant by `ctx.story.actLine.plotMode`, templates `{{currentScene}}` / `{{currentActPhase}}` / `{{inventoryToolsInstruction}}`, and the result renders as the **last user message** via the existing `buildGamePhaseMessages()`. The extraction content moves out of the system prompt; the now-obsolete locale strings `pipeline.extraction.gameMaster` / `pipeline.extraction.gameMasterInventory` and their bridge functions are deleted. The non-streaming regeneration path (`game-data-regenerator.ts`) switches to the fs guidance extraction prompt.

**Tech Stack:** Tauri v2 + SvelteKit 5, TypeScript (strict), Svelte 5 runes, js-yaml config manifest, vitest.

---

## Background Facts (verified)

- `executeGmPhase()` (runners.ts:534-548) currently calls `resolveGmSystemPrompt(ctx)` and `resolveGmExtractionPrompt()` (no args).
- `resolveGmSystemPrompt()` (runners.ts:109-113) replaces `{{additionalRules}}` → `''` and regex-replaces `{{inventoryToolsInstruction}}\r?\n` with `inventoryToolsPartial(indentLines(gameMasterInventoryToolsInstruction(), '   '))`.
- `resolveGmExtractionPrompt()` (runners.ts:115-118) is `isInventoryAvailable() ? `${gameMasterExtractionPrompt()} ${gameMasterInventoryExtractionPrompt()}` : gameMasterExtractionPrompt()`.
- `resolveCurrentActPhase(ctx)` (runners.ts:140-142) returns the localized act phase name; `ctx.currentScene` is a string; `ctx.story.actLine.plotMode` is `'guidance' | 'phaseEvent'`.
- Writer extraction prompts are fs `.md` files (`writer/guidance-writer-extraction-prompt.md`, `writer/phase-event-writer-extraction-prompt.md`) with placeholders like `{{currentScene}}`, `{{currentActPhase}}`, and are selected by `plotMode` at runners.ts:309-310.
- `gameMasterInventoryToolsInstruction()` (`pipeline.inventoryTools.gameMaster`) is a multi-line block: query-inventory before generating data, then update-inventory for changes.
- `game-data-regenerator.ts` (non-streaming GM for forked messages) currently passes `gameMasterSystemPromptLoader.loadDefault()` **without** placeholder replacement (literal `{{additionalRules}}` / `{{inventoryToolsInstruction}}` leak into the LLM) and appends `gameMasterExtractionPrompt()` as last message. It has no tools and no plot mode.
- New `.md` files must be added to `src/lib/fs/config-assets-manifest.yaml` via `npm run update-manifest` (script `scripts/update-config-manifest.mjs`, js-yaml dump options `quoteStyle: 'double'`, no `noCompatMode`). `registerBundledContent` picks up new files automatically via the `import.meta.glob` in `src/lib/fs/prompts.ts`.
- zh-Hant-HK locale files must be kept in parity with en (existing convention — every en prompt has a zh-Hant-HK sibling, including `game-master/game-master-prompt.md`).

---

### Task 1: Create en extraction prompts and restructure en system prompt

**Files:**
- Create: `src/lib/fs/en/prompts/game-master/guidance-game-master-extraction-prompt.md`
- Create: `src/lib/fs/en/prompts/game-master/phase-event-game-master-extraction-prompt.md`
- Modify: `src/lib/fs/en/prompts/game-master/game-master-prompt.md`

- [ ] **Step 1: Create `guidance-game-master-extraction-prompt.md`**

The guidance variant is scene-focused (mirrors `guidance-writer-extraction-prompt.md`). The numbered Instructions and the Output Format move here from the system prompt; the leading paragraph replaces the old locale string `pipeline.extraction.gameMaster`.

```markdown
## Game Data Extraction Task

Generate the game data for Scene {{currentScene}} based on the available information in the chat history.

1. Read the Editor Output (the final narrative text after review and revision). Optionally consider using available tools to obtain additional information.
2. From the player's perspective, identify active plot threads, decision context, and player-facing choices.
3. **Record Changes (Tools):** Before producing game data, call any tools needed to verify and record information from the scene.
{{inventoryToolsInstruction}}
4. Output game data following the GM Output format.

## Output Format

Produce your game data using the following template:

```markdown
# Game Data

## Active Plot Threads

- [unresolved situation or immediate goal]
- [another thread]

## Decision Context

[brief contextual description of the moment of choice]

## Decisions

- [Specific, actionable choice]
- [Alternative approach or dialogue option]
- [Escalating or aggressive choice]
- [Observational, teasing, or defensive choice]
```
```

- [ ] **Step 2: Create `phase-event-game-master-extraction-prompt.md`**

The phase-event variant is phase-aware (mirrors `phase-event-writer-extraction-prompt.md`): it names the current act phase and adds a one-paragraph phase-alignment instruction. The GM never advances phases (`advance-phase` is not in the GAME_MASTER tool set) and does not write narrative, so no pacing thresholds or table of phase core purposes — just phase context for decision generation.

```markdown
## Game Data Extraction Task

The current story phase of the act is {{currentActPhase}}. Generate the game data for this scene based on the available information in the chat history.

Keep the choices aligned with the current phase's narrative purpose: continue developing the active phase event and phase-appropriate challenges, without revealing events the player has not yet encountered or pushing the phase to end prematurely.

1. Read the Editor Output (the final narrative text after review and revision). Optionally consider using available tools to obtain additional information.
2. From the player's perspective, identify active plot threads, decision context, and player-facing choices.
3. **Record Changes (Tools):** Before producing game data, call any tools needed to verify and record information from the scene.
{{inventoryToolsInstruction}}
4. Output game data following the GM Output format.

## Output Format

Produce your game data using the following template:

```markdown
# Game Data

## Active Plot Threads

- [unresolved situation or immediate goal]
- [another thread]

## Decision Context

[brief contextual description of the moment of choice]

## Decisions

- [Specific, actionable choice]
- [Alternative approach or dialogue option]
- [Escalating or aggressive choice]
- [Observational, teasing, or defensive choice]
```
```

- [ ] **Step 3: Restructure `game-master-prompt.md` (en)**

Replace the whole file with the role declaration, the plot/secrecy boundary paragraph, and the Rules section only. The `## Instructions` section and the `## Output Format` section are removed (they moved into the two extraction prompts). `{{additionalRules}}` stays inside the Choice Variety rule (replacement mechanism unchanged in `resolveGmSystemPrompt`).

```markdown
# Game Master

You are an expert Gamemaster (GM) for an interactive narration game. You are not a character within the game world. Your role is to generate game data from the Editor Output, extracting the mechanical and tracking information needed for gameplay.

You have access to the Act Plot and Scene Plot, which outline potential upcoming events and narrative direction. The player does **not** know this information. Your output must strictly respect this boundary: never reveal, hint at, or presuppose knowledge the player has not yet encountered.

## Rules

- **Active Plot Threads:** List unresolved situations and immediate goals that the player is already aware of. Do not include threads the player could not know about. Use concise bullet points, limited to a maximum of 6.
- **Decision Context:** Provide a brief, 1-2 sentence framing of the exact moment the player must act.
- **Actionable Choices:** Generate 3-4 specific choices guiding the player toward interesting events without disclosing what will happen. Offer directions and clues rather than outcomes.
- **Choice Variety:** Ensure the generated choices include at least one escalating/aggressive option and one observational/defensive option. {{additionalRules}}
- **Succinct Choices:** Choices must be under 15 words. Keep it concise, succinct, direct, and strictly action-oriented. Do not apply formatting. Do not explain why the choice is generated.
```

- [ ] **Step 4: Verify the en files**

Run: `git diff --stat src/lib/fs/en/prompts/game-master/`
Expected: one modified file (`game-master-prompt.md`), two untracked files (`guidance-game-master-extraction-prompt.md`, `phase-event-game-master-extraction-prompt.md`). Confirm the modified file no longer contains `## Instructions` or `## Output Format`.

---

### Task 2: Create zh-Hant-HK counterparts (locale parity)

**Files:**
- Create: `src/lib/fs/zh-Hant-HK/prompts/game-master/guidance-game-master-extraction-prompt.md`
- Create: `src/lib/fs/zh-Hant-HK/prompts/game-master/phase-event-game-master-extraction-prompt.md`
- Modify: `src/lib/fs/zh-Hant-HK/prompts/game-master/game-master-prompt.md`

- [ ] **Step 1: Create `guidance-game-master-extraction-prompt.md` (zh-Hant-HK)**

```markdown
## 遊戲資料擷取任務

根據聊天記錄中的可用資訊，為場景 {{currentScene}} 生成遊戲資料。

1. 閱讀編輯輸出 (經審閱和修訂後的最終敘事文字) 。可考慮使用可用工具獲取額外資訊。
2. 從玩家的視角，識別現有劇情線索、回應脈絡和面向玩家的選項。
3. **記錄變更 (工具):** 在產生遊戲資料之前，呼叫任何需要的工具來驗證和記錄場景中的資訊。
{{inventoryToolsInstruction}}
4. 使用 GM 輸出格式輸出遊戲資料。

## 輸出格式

使用以下範本產出你的遊戲資料:

```markdown
# 遊戲資料

## 現有劇情線索

- [未解決的情況或即時目標]
- [另一條線索]

## 回應脈絡

[選擇時刻的簡短脈絡描述]

## 回應選項

- [具體、可操作的選項]
- [替代方法或對話選項]
- [行動升級或具攻擊性的選項]
- [觀察、挑釁或具防禦性的選項]
```
```

- [ ] **Step 2: Create `phase-event-game-master-extraction-prompt.md` (zh-Hant-HK)**

```markdown
## 遊戲資料擷取任務

目前章節的故事階段為 {{currentActPhase}}。根據聊天記錄中的可用資訊，為此場景生成遊戲資料。

選項應與目前故事階段的敘事重點保持一致: 繼續推進目前進行的階段事件與符合階段的挑戰，亦不要透露玩家尚未遇上的事件，也不要過早促使階段結束。

1. 閱讀編輯輸出 (經審閱和修訂後的最終敘事文字) 。可考慮使用可用工具獲取額外資訊。
2. 從玩家的視角，識別現有劇情線索、回應脈絡和面向玩家的選項。
3. **記錄變更 (工具):** 在產生遊戲資料之前，呼叫任何需要的工具來驗證和記錄場景中的資訊。
{{inventoryToolsInstruction}}
4. 使用 GM 輸出格式輸出遊戲資料。

## 輸出格式

使用以下範本產出你的遊戲資料:

```markdown
# 遊戲資料

## 現有劇情線索

- [未解決的情況或即時目標]
- [另一條線索]

## 回應脈絡

[選擇時刻的簡短脈絡描述]

## 回應選項

- [具體、可操作的選項]
- [替代方法或對話選項]
- [行動升級或具攻擊性的選項]
- [觀察、挑釁或具防禦性的選項]
```
```

- [ ] **Step 3: Restructure `game-master-prompt.md` (zh-Hant-HK)**

Replace the whole file with role declaration, secrecy boundary paragraph, and Rules only (drop `## 指令` and `## 輸出格式`, keep `{{additionalRules}}` inside Choice Variety):

```markdown
# GM

你是一個互動敘事遊戲的GM。你不是遊戲世界中的角色，你的角色是從編輯輸出中生成遊戲資料，擷取遊戲所需的機制性和追蹤性資訊。

你可以查閱劇情大綱和場景大綱，其中概述了潛在、可能即將發生的事件和敘事方向。玩家並不知道這些資訊。你的輸出必須嚴格遵守此界限：絕不揭露、暗示或預設玩家尚未得知的資訊。

## 規則

- **現有劇情線索: ** 列出玩家已經知曉的未解決情況和即時目標。不得列入玩家尚不知情的線索。以簡潔的要點例出最多 6 項線索。
- **回應脈絡: ** 提供簡短的 1-2 句話，描述玩家必須行動的確切時刻。
- **可操作的選項: ** 生成 3-4 個具體的選項，引導玩家朝向有趣的事件但不透露將會發生什麼。提供方向與線索，而非結果。
- **選項多樣性: ** 確保生成的選項至少包含一個行動升級/具攻擊性的選項和一個觀察/具防禦性的選項。 {{additionalRules}}
- **簡潔的選項: ** 每個選項必須簡短、直接並且嚴格要求以 15 字以內。不要格式化文字，亦不要加入額外說明。
```

- [ ] **Step 4: Verify parity**

Run: `Get-ChildItem src/lib/fs/en/prompts/game-master, src/lib/fs/zh-Hant-HK/prompts/game-master | Select-Object DirectoryName, Name`
Expected: both directories contain the same three filenames (`game-master-prompt.md`, `guidance-game-master-extraction-prompt.md`, `phase-event-game-master-extraction-prompt.md`).

---

### Task 3: Register the new loaders

**Files:**
- Modify: `src/lib/fs/prompts.ts` (Game master section, currently at line 63-65)
- Modify: `src/lib/ai/pipeline/prompt-loader.ts` (imports + `promptLoaderDefinitions`)

- [ ] **Step 1: Add loaders in `src/lib/fs/prompts.ts`**

Replace:

```ts
// === Game master ===

export const gameMasterSystemPromptLoader = createLoader('game-master/game-master-prompt.md');
```

with:

```ts
// === Game master ===

export const gameMasterSystemPromptLoader = createLoader('game-master/game-master-prompt.md');
export const guidanceGameMasterExtractionPromptLoader = createLoader('game-master/guidance-game-master-extraction-prompt.md');
export const phaseEventGameMasterExtractionPromptLoader = createLoader('game-master/phase-event-game-master-extraction-prompt.md');
```

- [ ] **Step 2: Register loaders in `src/lib/ai/pipeline/prompt-loader.ts`**

Add to the import block (alphabetical, after `gameMasterSystemPromptLoader`):

```ts
	guidanceGameMasterExtractionPromptLoader,
	phaseEventGameMasterExtractionPromptLoader,
```

Add to `promptLoaderDefinitions` (after `gameMasterSystemPrompt`):

```ts
	guidanceGameMasterExtractionPrompt: guidanceGameMasterExtractionPromptLoader,
	phaseEventGameMasterExtractionPrompt: phaseEventGameMasterExtractionPromptLoader,
```

---

### Task 4: Extend `PipelinePrompts` plumbing

**Files:**
- Modify: `src/lib/ai/pipeline/runners.ts` (`PipelinePrompts` interface, lines 260-271)
- Modify: `src/lib/ai/pipeline/index.ts` (`preparePipelinePrompts`, lines 62-77)
- Modify: `src/lib/features/import-world/pipeline-context.ts` (prompts defaults, lines 62-74)

- [ ] **Step 1: Add fields to `PipelinePrompts` in runners.ts**

Replace:

```ts
	guidanceWriterExtractionPrompt: string;
	phaseEventWriterExtractionPrompt: string;
}
```

with:

```ts
	guidanceWriterExtractionPrompt: string;
	phaseEventWriterExtractionPrompt: string;
	guidanceGameMasterExtractionPrompt: string;
	phaseEventGameMasterExtractionPrompt: string;
}
```

- [ ] **Step 2: Map the loaded prompts in `index.ts`**

Replace:

```ts
		guidanceWriterExtractionPrompt: loadedPrompts.guidanceWriterExtractionPrompt,
		phaseEventWriterExtractionPrompt: loadedPrompts.phaseEventWriterExtractionPrompt,
	};
```

with:

```ts
		guidanceWriterExtractionPrompt: loadedPrompts.guidanceWriterExtractionPrompt,
		phaseEventWriterExtractionPrompt: loadedPrompts.phaseEventWriterExtractionPrompt,
		guidanceGameMasterExtractionPrompt: loadedPrompts.guidanceGameMasterExtractionPrompt,
		phaseEventGameMasterExtractionPrompt: loadedPrompts.phaseEventGameMasterExtractionPrompt,
	};
```

- [ ] **Step 3: Add empty-string defaults in `import-world/pipeline-context.ts`**

Replace:

```ts
			guidanceWriterExtractionPrompt: '',
			phaseEventWriterExtractionPrompt: '',
			...prompts,
```

with:

```ts
			guidanceWriterExtractionPrompt: '',
			phaseEventWriterExtractionPrompt: '',
			guidanceGameMasterExtractionPrompt: '',
			phaseEventGameMasterExtractionPrompt: '',
			...prompts,
```

---

### Task 5: Rewire GM prompt resolution in runners.ts

**Files:**
- Modify: `src/lib/ai/pipeline/runners.ts` (imports at lines 38-61, `resolveGmSystemPrompt`/`resolveGmExtractionPrompt` at lines 109-118, `executeGmPhase` at line 542)

- [ ] **Step 1: Update the pipeline-prompts import block**

In the second import block from `$lib/definitions/pipeline-prompts`, remove:

```ts
	gameMasterExtractionPrompt,
	gameMasterInventoryExtractionPrompt,
```

Keep `gameMasterInventoryToolsInstruction` (still used for the extraction prompt template).

- [ ] **Step 2: Rewrite `resolveGmSystemPrompt` and `resolveGmExtractionPrompt`**

Replace:

```ts
function resolveGmSystemPrompt(ctx: PipelineRunContext): string {
	return ctx.prompts.gameMasterSystemPrompt
		.replaceAll('{{additionalRules}}', '')
		.replaceAll(/{{inventoryToolsInstruction}}\r?\n/g, inventoryToolsPartial(indentLines(gameMasterInventoryToolsInstruction(), '   ')));
}

function resolveGmExtractionPrompt(): string {
	const base = gameMasterExtractionPrompt();
	return isInventoryAvailable() ? `${base} ${gameMasterInventoryExtractionPrompt()}` : base;
}
```

with:

```ts
function resolveGmSystemPrompt(ctx: PipelineRunContext): string {
	return ctx.prompts.gameMasterSystemPrompt.replaceAll('{{additionalRules}}', '');
}

function resolveGmExtractionPrompt(ctx: PipelineRunContext): string {
	const base =
		ctx.story.actLine.plotMode === 'phaseEvent'
			? ctx.prompts.phaseEventGameMasterExtractionPrompt
			: ctx.prompts.guidanceGameMasterExtractionPrompt;
	return base
		.replaceAll('{{currentScene}}', ctx.currentScene)
		.replaceAll('{{currentActPhase}}', resolveCurrentActPhase(ctx))
		.replaceAll(/{{inventoryToolsInstruction}}\r?\n/g, inventoryToolsPartial(indentLines(gameMasterInventoryToolsInstruction(), '   ')));
}
```

Note: `resolveCurrentActPhase` is declared later in the same file (line 140) — function declarations hoist, no change needed. The `{{inventoryToolsInstruction}}` regex still matches once (the placeholder line is followed by `\n` before step 4), and `inventoryToolsPartial` returns `''` when inventory is unavailable, collapsing the placeholder line entirely.

- [ ] **Step 3: Update the call site in `executeGmPhase`**

Replace:

```ts
		messages: buildGamePhaseMessages(postEditorCtx, resolveGmExtractionPrompt()),
```

with:

```ts
		messages: buildGamePhaseMessages(postEditorCtx, resolveGmExtractionPrompt(ctx)),
```

- [ ] **Step 4: Verify no stale references**

Run: `npm run check`
Expected: PASS — no unused-import or property errors. (Also confirms `isInventoryAvailable` import in runners.ts is still used by `inventoryToolsPartial`.)

---

### Task 6: Update `game-data-regenerator.ts` (non-streaming GM)

**Files:**
- Modify: `src/lib/ai/game-data-regenerator.ts`

The regenerator mirrors the GM phase for forked messages but runs `generateText` **without tools**, so `{{inventoryToolsInstruction}}` renders empty (do not gate on `isInventoryAvailable()` — instructing a tool-less model to call tools is worse than omitting, and matches today's behavior). It uses the guidance variant (no plot mode available).

- [ ] **Step 1: Update imports**

Replace:

```ts
import { gameMasterSystemPromptLoader } from '$lib/fs/prompts';
```

with:

```ts
import { gameMasterSystemPromptLoader, guidanceGameMasterExtractionPromptLoader } from '$lib/fs/prompts';
```

Replace:

```ts
import { gameMasterExtractionPrompt } from '$lib/definitions/pipeline-prompts';
```

with nothing (delete the line).

- [ ] **Step 2: Build the system prompt and extraction prompt from fs loaders**

Replace:

```ts
	const gameMasterSystemPrompt = await gameMasterSystemPromptLoader.loadDefault();
```

with:

```ts
	const gameMasterSystemPrompt = (await gameMasterSystemPromptLoader.loadDefault()).replaceAll('{{additionalRules}}', '');
	const gmExtractionPrompt = (await guidanceGameMasterExtractionPromptLoader.loadDefault())
		.replaceAll('{{currentScene}}', String(sceneNumber))
		.replaceAll(/{{inventoryToolsInstruction}}\r?\n/g, '');
```

- [ ] **Step 3: Use the fs extraction prompt as the last message**

Replace:

```ts
		gameMasterExtractionPrompt(),
	];
```

with:

```ts
		gmExtractionPrompt,
	];
```

---

### Task 7: Remove obsolete locale strings and bridge functions

**Files:**
- Modify: `src/lib/definitions/pipeline-prompts.ts` (lines 38-39)
- Modify: `src/lib/fs/locale-strings/en.yaml` (lines 94-95)
- Modify: `src/lib/fs/locale-strings/zh-Hant-HK.yaml` (lines 93-94)

- [ ] **Step 1: Delete the bridge functions**

Replace in `src/lib/definitions/pipeline-prompts.ts`:

```ts
// Extraction prompts
export const gameMasterExtractionPrompt = () => ls('pipeline.extraction.gameMaster');
export const gameMasterInventoryExtractionPrompt = () => ls('pipeline.extraction.gameMasterInventory');
export const editorExtractionPrompt = () => ls('pipeline.extraction.editor');
```

with:

```ts
// Extraction prompts
export const editorExtractionPrompt = () => ls('pipeline.extraction.editor');
```

(`gameMasterInventoryToolsInstruction` at line 94 is `pipeline.inventoryTools.gameMaster` — do NOT delete it.)

- [ ] **Step 2: Delete the en locale keys**

In `src/lib/fs/locale-strings/en.yaml`, delete exactly these two lines:

```yaml
    gameMaster: Generate the game data based on the available information in the chat history.
    gameMasterInventory: Use the `update-inventory` tool to record any inventory changes that occurred during the scene (items acquired, lost, consumed, equipped, unequipped, used, or modified, and status effects).
```

- [ ] **Step 3: Delete the zh-Hant-HK locale keys**

In `src/lib/fs/locale-strings/zh-Hant-HK.yaml`, delete exactly these two lines:

```yaml
    gameMaster: 根據聊天記錄中的可用資訊，生成遊戲資料。
    gameMasterInventory: 使用 `update-inventory` 工具記錄場景中發生的物品欄變化 (獲得、失去、消耗、裝備、卸下、使用或修改物品，以及狀態效果)。
```

- [ ] **Step 4: Confirm no remaining usages**

Run: `rg "gameMasterExtractionPrompt|gameMasterInventoryExtractionPrompt|pipeline\.extraction\.gameMaster" src --glob '!**/localization/README.md'`
Expected: no matches. (The `localization/README.md` bridge-module example mentions `gameMasterExtractionPrompt()` but is already stale for the writer functions — leave untouched per surgical-change convention.)

---

### Task 8: Regenerate the config manifest

**Files:**
- Modify: `src/lib/fs/config-assets-manifest.yaml` (regenerated — adds 4 new entries, updates hashes for `game-master-prompt.md` × 2 locales and `locale-strings` × 2 locales)

- [ ] **Step 1: Run the manifest script**

Run: `npm run update-manifest`
Expected output: `Manifest updated: ...config-assets-manifest.yaml`

- [ ] **Step 2: Verify the manifest contains the new files**

Run: `rg -c "guidance-game-master-extraction-prompt|phase-event-game-master-extraction-prompt" src/lib/fs/config-assets-manifest.yaml`
Expected: `4` (2 file names × 2 locales). Also confirm `game-master-prompt.md` hashes changed (new `hash:` values under both locale trees).

---

### Task 9: Full verification

- [ ] **Step 1: Type check**

Run: `npm run check`
Expected: PASS, exit code 0.

- [ ] **Step 2: Unit tests**

Run: `npm run test`
Expected: PASS — all suites green (no existing test touches the GM locale strings or runner prompts; `config-manifest.test.ts` parses the manifest and must still pass with the new entries).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS — no unused imports (`gameMasterExtractionPrompt`, `gameMasterInventoryExtractionPrompt` fully removed from runners.ts).

- [ ] **Step 4: Manual sanity check of resolved prompts**

Run: `rg "inventoryToolsInstruction" src/lib/fs/en/prompts/game-master src/lib/fs/zh-Hant-HK/prompts/game-master`
Expected: exactly one match per file (the placeholder inside each extraction prompt's step 3), and **no** matches in `game-master-prompt.md` (both locales). The placeholder is replaced at runtime by `resolveGmExtractionPrompt(ctx)`.

---

## Self-Review

**Spec coverage:**
1. ✅ Two new files under `src/lib/fs/en/prompts/game-master` (Task 1) + zh-Hant-HK parity (Task 2), written by studying the writer guidance/phase-event variants.
2. ✅ `game-master-prompt.md` keeps role declaration + Rules (system prompt); Instructions + Output Format moved to the extraction prompt (Tasks 1-2); nothing else needed moving (phase-event variant adds phase context; no GM-specific act-end content exists today).
3. ✅ `pipeline.extraction.gameMasterInventory` content templated into the extraction prompt via `{{inventoryToolsInstruction}}` (Tasks 5 + 7 — the locale key is deleted).
4. ✅ Plot-mode selection wired in `executeGmPhase()` via `resolveGmExtractionPrompt(ctx)` (Task 5).

**Placeholder scan:** All steps contain exact content/commands; no TODOs.

**Type consistency:** `PipelinePrompts.guidanceGameMasterExtractionPrompt` / `phaseEventGameMasterExtractionPrompt` consistently named across runners.ts, index.ts, prompt-loader.ts, import-world/pipeline-context.ts. `resolveGmExtractionPrompt` has one signature (`(ctx: PipelineRunContext) => string`) used at one call site. Regenerator uses `gmExtractionPrompt` string in one place.