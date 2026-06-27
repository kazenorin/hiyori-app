---
name: add-provider-tips-rule
description: 'Add a new provider configuration tip rule to the declarative rules.yaml system. Use when: (1) Adding a new warning/note/verified tip for provider configuration, (2) Need a new predicate matcher for URL/provider/model conditions, (3) Need a new suggestion type for the Apply button, (4) Adding i18n keys for tip messages. Triggers on: "add provider tip", "new provider rule", "rules.yaml", "provider tip rule", "predicate DSL", "provider config tip".'
---

## Overview

Provider configuration tips are driven by a **declarative rule system**. Rules are defined in `rules.yaml`, evaluated by a predicate DSL (`predicates.ts`) against a `TipEvaluationInput` snapshot, and the single highest-priority match is rendered as a tip in `ProviderTips.svelte` with an optional Apply button. This skill guides you through adding a new rule end-to-end.

## Architecture

```
rules.yaml (declarative rules)
  ↓ loaded at module init
evaluator.ts (compiles rules, evaluates by priority, returns single winner)
  ↓ uses
predicates.ts (matchField DSL + matchWhen)
  ↓ uses
known-providers.ts (verified provider list)
  ↓ result: ProviderConfigTip
ProviderForm.svelte ($derived tip) → ProviderTips.svelte (render + Apply)
```

## Source Files

| File                                            | Role                                                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/lib/ai/provider-tips/rules.yaml`           | Declarative rule definitions                                                                                    |
| `src/lib/ai/provider-tips/predicates.ts`        | Predicate DSL: `FieldCondition` type, `matchField()`, `matchWhen()`                                             |
| `src/lib/ai/provider-tips/evaluator.ts`         | Rule compilation, `evaluateProviderTip()`, suggestion types, `applyStripSuffix()`, `expandSuggestionTemplate()` |
| `src/lib/ai/provider-tips/known-providers.ts`   | Known provider lookup (`findKnownProvider`, `isInKnownProviders`, `isModelVerifiedForBaseUrl`)                  |
| `src/lib/ai/provider-tips/known-providers.yaml` | Verified provider list (base URLs + models)                                                                     |
| `src/lib/components/chat/ProviderForm.svelte`   | `handleApplySuggestion()` handler — one `case` per suggestion type                                              |
| `src/lib/components/chat/ProviderTips.svelte`   | Tip rendering (icon, badge, message, Apply button)                                                              |
| `src/lib/i18n/locales/en.json`                  | English i18n keys under `settings.providerTips.rules.*`                                                         |
| `src/lib/i18n/locales/zh-Hant-HK.json`          | Chinese i18n keys under `settings.providerTips.rules.*`                                                         |
| `src/lib/__tests__/provider-tips.test.ts`       | Unit tests (tests covering all rules, predicates, platforms)                                                    |

## Known Providers

A separate YAML file (`known-providers.yaml`) maintains a curated list of OpenAI-compatible base URLs known to work, along with their verified models. This list powers two predicates in the rule DSL:

- **`inKnownProviders: true`** — matches when the base URL is in the known-providers list (normalizes trailing slashes).
- **`inKnownProvidersForBaseUrl: true` / `false`** — matches when the model is verified (or not) for the given base URL. A provider with `models: "*"` verifies all models; otherwise the model must appear in the list.

**`known-providers.yaml` format:**

```yaml
providers:
  - baseUrl: https://api.example.com/v1
    models: '*' # All models verified
  - baseUrl: https://openrouter.ai/api/v1
    models: # Specific verified models only
      - z-ai/glm-5.2
      - google/gemma-4-31b-it
```

This is used by rules A5 (verified — provider and model both known) and A5b (note — provider known but model not verified). Both predicates support `true` and `false` values, so you can write rules that match the negative case (e.g., "model is NOT verified").

**Adding a known provider:** simply append a new entry to `known-providers.yaml`. No code changes needed — the YAML is loaded at module init in `known-providers.ts` and lookup functions handle normalization automatically.

## Step-by-Step: Adding a New Rule

### Step 1 — Choose ID and priority

Rule IDs follow a letter-prefixed convention:

| Prefix | Scope                                              | Example                           |
| ------ | -------------------------------------------------- | --------------------------------- |
| `A`    | All platforms                                      | `A1-openai-non-official-base-url` |
| `B`    | Web app only (`platform: web`)                     | `B1-nvidia-no-proxy`              |
| `C`    | Desktop/Android only (`platform: desktop-android`) | `C1-ollama-default-verified`      |

Priority bands (LOWER = stronger — wins over higher numbers):

| Priority | Kind     | Use for                                            |
| -------- | -------- | -------------------------------------------------- |
| 10       | warning  | Hard warnings (known-broken configs)               |
| 20       | warning  | Soft warnings (likely-broken configs)              |
| 25       | note     | More-specific notes (override broader notes at 30) |
| 30       | note     | General notes / caveats                            |
| 40       | verified | Verified-provider affirmations (weakest)           |

When multiple rules match, the **single** lowest-priority-number rule wins (ties broken by declaration order in YAML).

### Step 2 — Write the rule in rules.yaml

```yaml
rules:
  # ...existing rules...

  - id: D1-my-new-rule # Unique, descriptive, kebab-case
    platform: all # all | web | desktop | android | desktop-android
    kind: warning # warning | note | verified
    priority: 20 # See priority bands above
    when:
      provider: openai-compatible # Shorthand for { equals: 'openai-compatible' }
      baseURL:
        endsWith: /v1 # Any FieldCondition from predicates.ts
        isNonEmpty: true
      corsBypassEnabled: false # Shorthand for { equals: false }
      pageProtocol: https # Shorthand for { equals: 'https' }
    messageKey: settings.providerTips.rules.D1
    suggest: # Optional — adds Apply button
      rewriteBaseUrl: https://api.example.com/v1
```

### Step 3 — Add i18n keys

Add the message key under `settings.providerTips.rules` in **both** locale files:

**`src/lib/i18n/locales/en.json`:**

```json
"providerTips": {
    "apply": "Apply",
    "verifiedBadge": "Verified Provider",
    "rules": {
        "D1": "Your tip message here. Use {{baseUrl}} or {{model}} for interpolation."
    }
}
```

**`src/lib/i18n/locales/zh-Hant-HK.json`:**

```json
"providerTips": {
    "apply": "套用",
    "verifiedBadge": "已驗證提供者",
    "rules": {
        "D1": "您的提示訊息。可使用 {{baseUrl}} 或 {{model}} 進行插值。"
    }
}
```

**Interpolation params** (auto-populated by `buildMessageParams()` in evaluator.ts):

- `{{baseUrl}}` — the user's current base URL
- `{{model}}` — the user's current model name
- `{{host}}` — the hostname:port from the base URL (omitted if URL is invalid)

### Step 4 — Do you need a new predicate?

Check the existing `FieldCondition` type and `matchField()` function in `src/lib/ai/provider-tips/predicates.ts` to see all available predicates. Read the source to understand what each predicate does and how it's implemented.

**If you need a new predicate**, add it in three places:

1. **`predicates.ts`** — add the field to `FieldCondition` type, add the check in `matchField()`, add the implementation function:

```typescript
// 1. Add to FieldCondition type
export type FieldCondition = {
	// ...existing fields...
	myNewCheck?: string;
};

// 2. Add check in matchField()
export function matchField(value: string, cond: FieldCondition, context: { baseURL: string; model: string }): boolean {
	// ...existing checks...
	if (cond.myNewCheck !== undefined && !matchesMyNewCheck(value, cond.myNewCheck)) return false;
	return true;
}

// 3. Add implementation
function matchesMyNewCheck(value: string, expected: string): boolean {
	// ...
}
```

2. **`evaluator.ts`** — no changes needed for predicates (the `RawRule.when` type already intersects with `WhenBlock` which re-exports `FieldCondition`). But if you add a new **top-level `when` field** (not a `FieldCondition` on provider/baseURL/model), you need to:
   - Add it to `WhenBlock` in `predicates.ts`
   - Add the matching logic in `matchWhen()`
   - Add normalization in `normalizeWhen()` in `evaluator.ts`

3. **Tests** — add unit tests in `src/lib/__tests__/provider-tips.test.ts` under the `predicates — matchField` describe block.

### Step 5 — Do you need a new suggestion type?

Check the existing `ProviderTipSuggestion` union type and `buildSuggestion()` function in `src/lib/ai/provider-tips/evaluator.ts` to see all available suggestion types. Read the source to understand how each suggestion type is built and applied. The Apply behavior for each type is implemented in `handleApplySuggestion()` in `src/lib/components/chat/ProviderForm.svelte`.

**If you need a new suggestion type**, add it in four places:

1. **`evaluator.ts`** — add to `ProviderTipSuggestion` union type and `RawRule.suggest` interface, add dispatch in `buildSuggestion()`:

```typescript
// 1. Add to union type
export type ProviderTipSuggestion =
	| { type: 'rewriteBaseUrl'; value: string }
	// ...existing...
	| { type: 'myNewSuggestion'; value: string };

// 2. Add to RawRule.suggest
interface RawRule {
	// ...
	suggest?: {
		// ...existing...
		myNewSuggestion?: string;
	};
}

// 3. Add dispatch in buildSuggestion()
function buildSuggestion(raw: NonNullable<RawRule['suggest']>): ProviderTipSuggestion | undefined {
	// ...existing branches...
	if (raw.myNewSuggestion !== undefined) {
		return { type: 'myNewSuggestion', value: raw.myNewSuggestion };
	}
	return undefined;
}
```

2. **`ProviderForm.svelte`** — add a `case` in `handleApplySuggestion()`:

```svelte
case 'myNewSuggestion': {
    // Apply the suggestion to formBaseURL / formProvider / etc.
    break;
}
```

3. **`rules.yaml`** — use the new key in a rule's `suggest:` block.

4. **Tests** — add a test verifying the suggestion type is correctly built and the rule fires.

### Step 6 — Write tests

Add tests in `src/lib/__tests__/provider-tips.test.ts`:

```typescript
describe('evaluator — rule D1 (my new rule)', () => {
	it('fires when condition matches', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'https://example.com/v1', model: 'google/gemma-4-31b' })
		);
		expect(tip).not.toBeNull();
		expect(tip!.id).toBe('D1-my-new-rule');
		expect(tip!.kind).toBe('warning');
		expect(tip!.suggest).toEqual({ type: 'rewriteBaseUrl', value: 'https://...' });
	});

	it('does not fire when condition does not match', () => {
		const tip = evaluateProviderTip(baseInput({ provider: 'ollama', baseURL: 'http://localhost:11434', model: 'llama3' }));
		expect(tip).toBeNull();
	});
});
```

**Test conventions in this file:**

- Use `baseInput()` helper (spreads defaults, accepts overrides)
- Default model is `'google/gemma-4-31b'`
- For platform-specific rules, test all applicable platforms with `for (const platform of ['web', 'desktop', 'android'] as const)`
- Verify priority interactions ("Rule X beats Rule Y because lower priority number")
- When a rule should NOT fire on a platform, verify a _different_ rule fires instead (don't just assert `null` — other rules may fire)

### Step 7 — Verify

```bash
# Run the provider-tips tests
npm test -- --run provider-tips

# Type check
npm run check

# Lint changed files
npx eslint src/lib/ai/provider-tips/ src/lib/components/chat/ProviderForm.svelte src/lib/__tests__/provider-tips.test.ts
```

## YAML Shorthand Conventions

The evaluator normalizes bare values in `when:` blocks:

| YAML                       | Normalized to                          |
| -------------------------- | -------------------------------------- |
| `provider: openai`         | `provider: { equals: 'openai' }`       |
| `corsBypassEnabled: false` | `corsBypassEnabled: { equals: false }` |
| `pageProtocol: https`      | `pageProtocol: { equals: 'https' }`    |

You can use either form. The shorthand is preferred for simple equality checks.

## Common Pitfalls

1. **`inKnownProvidersForBaseUrl: false`** — the value `false` means "model is NOT verified". The predicate compares `cond.inKnownProvidersForBaseUrl !== isVerified`, so `false` matches when the model is unverified. Don't confuse this with omitting the field.

2. **Priority conflicts** — before adding a rule, check which existing rules could match the same input. If your new rule has a higher priority number, it will never be shown when a conflicting rule fires. Use a lower number (e.g., 25 to override a 30).

3. **Platform gating** — rules with `platform: web` never fire on desktop/android, and vice versa. Test cross-platform behavior explicitly.

4. **`pageProtocol` defaults** — `baseInput()` in tests sets `pageProtocol: 'https'` by default. If your rule is web-only and you don't want B3 to interfere, set `pageProtocol: 'http'` or test on the appropriate platform.

5. **Bare string vs object** — `provider: openai` works (normalized to `{ equals: 'openai' }`), but `baseURL: openai` would also be normalized to `{ equals: 'openai' }`, which is almost certainly not what you want for a URL field. Use the explicit object form for URL conditions: `baseURL: { endsWith: '/v1' }`.
