---
name: add-icon
description: 'Add a new Lucide icon to the internal icon set. Use when: (1) Need to add a new SVG icon to the project, (2) Looking up a Lucide icon by name or tag, (3) Internalizing a Lucide icon into src/lib/ui/icons.ts. Triggers on: "add icon", "new icon", "lucide icon", "icons.ts", "IconName", "Icon component".'
---

## Overview

Icons are centralized in `src/lib/ui/icons.ts` as an `ICONS` record. Each entry is an `IconDef` (viewBox + SVG body + stroke/fill settings). The `Icon.svelte` component renders any icon by name. All icons originate from the Lucide icon set — reference materials are stored locally.

## Reference Materials

| Resource          | Path                                          | Use for                                                                                    |
|-------------------|-----------------------------------------------|--------------------------------------------------------------------------------------------|
| Lucide icon tags  | `node_modules/lucide-static/tags.json`        | Search by keyword to find icon names (e.g. search "warning" → `triangle-alert`)            |
| Lucide icon nodes | `node_modules/lucide-static/icon-nodes.json`  | Structured node data (tag + attributes) for each icon — useful for programmatic extraction |
| Lucide icon SVGs  | `node_modules/lucide-static/icons/<name>.svg` | Full SVG source to extract the inner `<path>`/`<circle>`/etc. body                         |
| Internal icon set | `src/lib/ui/icons.ts`                         | Where icons are registered (`ICONS` record)                                                |
| Icon component    | `src/lib/components/ui/Icon.svelte`           | `<Icon name="..." />` component                                                            |

## How Icons Work

### `icons.ts`

Two factory functions produce `IconDef` entries:

```typescript
// Stroke-based icon (outline style, follows currentColor)
stroke(body: string, viewBox = '0 0 24 24'): IconDef
// → { viewBox, body, fill: 'none', stroke: 'currentColor', strokeWidth: 2,
//     strokeLinecap: 'round', strokeLinejoin: 'round' }

// Filled icon (solid style, uses currentColor as fill)
filled(body: string): IconDef
// → { viewBox: '0 0 20 20', body, fill: 'currentColor', stroke: 'none' }
```

Icons are registered in the `ICONS` object:

```typescript
export const ICONS = {
	'triangle-alert': stroke(
		'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" />'
	),
	// ...
} as const satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;
```

### `Icon.svelte`

```svelte
<Icon name="triangle-alert" class="size-4 text-warning-500" aria-hidden="true" />
```

Props: `name` (required, must be a key of `ICONS`), `class`, `aria-label`, `aria-hidden`. All other SVG attributes are spread via `{...rest}`.

## Step-by-Step: Adding a New Icon

### Step 1 — Find the icon

Search `~/dev/materials/hiyori-app/public-docs/lucide/tags.json` for a keyword to find candidate icon names:

```bash
# Example: find icons tagged with "warning"
cat ~/dev/materials/hiyori-app/public-docs/lucide/tags.json | grep -i warning
```

Alternatively, if you know the exact icon name, verify it exists:

```bash
cat ~/dev/materials/hiyori-app/public-docs/lucide/tags.json | grep '"triangle-alert"'
```

### Step 2 — Read the SVG source

Open the SVG file to extract the inner SVG body (the `<path>`, `<circle>`, `<line>`, `<polygon>`, etc. elements — everything inside the `<svg>` tag):

```bash
cat ~/dev/materials/hiyori-app/public-docs/lucide/lucide-static/icons/<icon-name>.svg
```

For example, `triangle-alert.svg`:

```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
  <path d="M12 9v4" />
  <path d="M12 17h.01" />
</svg>
```

The inner body to extract is:

```html
<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" />
```

### Step 3 — Choose stroke vs filled

Lucide icons are **stroke-based** by default (outline style with `fill="none"`, `stroke="currentColor"`). Use the `stroke()` factory for these.

Some icons in the codebase use `filled()` instead — these are typically sourced from other icon sets (e.g. Hero Icons solid) and use `fill="currentColor"` with `viewBox="0 0 20 20"`. Only use `filled()` for solid icons, not for standard Lucide stroke icons.

**Default rule: use `stroke()` for Lucide icons.** The factory already matches Lucide's defaults (`viewBox: 0 0 24 24`, `strokeWidth: 2`, `strokeLinecap: round`, `strokeLinejoin: round`).

### Step 4 — Add to `ICONS` in `src/lib/ui/icons.ts`

Append the new entry to the `ICONS` object. Use the Lucide icon name as the key (kebab-case):

```typescript
export const ICONS = {
	// ...existing icons...

	'my-new-icon': stroke('<path d="..." /><circle cx="12" cy="12" r="10" />'),
} as const satisfies Record<string, IconDef>;
```

**Conventions:**

- Key: kebab-case, matching the Lucide icon name (e.g. `'triangle-alert'`, not `'TriangleAlert'` or `'triangle_alert'`)
- Body: concatenation of all inner SVG elements (paths, circles, lines, polygons) — no whitespace needed between elements
- Do not include the `<svg>` wrapper, `viewBox`, `fill`, `stroke`, or `stroke-width` attributes — the factory and `Icon.svelte` handle those

### Step 5 — Use in a component

```svelte
<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
</script>

<Icon name="my-new-icon" class="size-4 text-primary-500" aria-hidden="true" />
```

Common size classes used in the codebase: `h-4 w-4`, `h-5 w-5`, `size-4`. Use Skeleton + Tailwind color tokens (e.g. `text-warning-500`, `text-primary-500`, `text-success-500`) — never hardcode color values.

### Step 6 — Verify

```bash
# Type check (confirms the new IconName is valid)
npm run check

# Lint
npx eslint src/lib/ui/icons.ts
```

## Tips

- **Multiple elements**: concatenate `<path>`, `<circle>`, `<line>`, `<polygon>` elements directly — no commas or separators needed
- **Self-closing tags**: ensure all elements are self-closed (`<path ... />`)
- **Nested fills**: if an icon needs a filled element inside a stroke icon (e.g. `'keep-plot'` has `fill="currentColor"` on an inner circle), add `fill="currentColor"` directly on that element's attributes
- **Icon naming**: if the Lucide name has a number suffix (e.g. `volume-2`), keep it as-is in kebab-case
- **Alternative to `icon-nodes.json`**: the structured node data (`[["path", {"d": "..."}], ...]`) can be used for programmatic extraction, but for manual addition, reading the SVG file is simpler
