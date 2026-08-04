---
name: generate-names
description: 'Grow the curated Analytic-Mode name database from web sources. Use when: (1) Adding names for a culture or locale that is sparse/missing, (2) Adding a brand-new culture or locale to the name database, (3) Topping up the per-culture JSON name files, (4) Researching real/fantasy names grounded in web sources for the suggest-character-name tool. Triggers on: "generate names", "grow name database", "add names", "name database", "names JSON", "suggest-character-name data", "fill name coverage".'
---

## Overview

The Analytic Mode of the `suggest-character-name` tool is backed by a curated, categorized name
database: hand-authored JSON files, one per culture and gender. Names are grown from **web-grounded
research**: research + classification (judgment) produce entries; validation, dedup, and quota
curation happen deterministically at runtime. Never invent names — report shortfalls honestly.

```
BehindTheName (webfetch) ──research+classify──▶ JSON entries
                                                      │
                          append to src/lib/fs/<locale>/names/<culture>.json
                                                      │
                                        npm run update-manifest
                                                      ▼
                                src/lib/fs/config-assets-manifest.yaml (hash refresh)
```

## Source Files

| File                                                                                   | Role                                                                                                          |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/lib/fs/<locale>/names/<culture>.json`                                             | The bundled name data: one JSON array per culture.                                                             |
| `src/lib/features/name-suggestion/types.ts`                                            | Canonical enums: `GENDERS`, `CULTURES`, `DATA_NAME_TYPES`, `MEANING_TAGS`, `NAME_THEMES`, `CULTURE_META` (name order), `STORY_THEME_TO_NAME_THEME` (story→name theme mapping). |
| `src/lib/features/name-suggestion/json.ts`                                             | Runtime JSON parser (`parseNameDataset`) with per-entry validation.                                            |
| `src/lib/features/name-suggestion/quota.ts`                                            | Quota config + load-time curation (`DEFAULT_NAME_QUOTAS`, `allocateQuotas`, `applyQuotas`).                    |
| `src/lib/features/name-suggestion/engine.ts`                                           | Filtering + full-name composition (`suggestNames`, `formatFullName`).                                          |
| `src/lib/features/name-suggestion/README.md`                                           | Data-format reference (entry shape, quotas, composition, avoidance).                                           |
| `src/lib/__tests__/features/name-suggestion/dataset.test.ts`                           | Bundled-data quality gates: no invalid entries, only real themes, dedup.                                       |
| `src/lib/fs/config-assets-manifest.yaml`                                               | Config-asset hashes; refresh with `npm run update-manifest` after JSON changes.                                |

## Schema (must match `types.ts` exactly)

Each file is a JSON array of entries. `full` names are **never stored** — they are composed from
`given` + `family` at query time.

```json
{
	"name": "Archer",
	"genders": ["masculine"],
	"themes": ["modern", "fantasy"],
	"cultures": ["european"],
	"nameTypes": ["given"],
	"meaningTags": ["martial"]
}
```

| Field         | Allowed values                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `genders`     | `masculine`, `feminine`, `neutral` (multi OK, e.g. `["masculine","feminine"]`)                                                                            |
| `themes`      | `fantasy`, `modern`, `sci-fi` (consolidated `NAME_THEMES`; story themes map onto these via `STORY_THEME_TO_NAME_THEME`)                                  |
| `cultures`    | `european`, `japanese`, `chinese`, `middle-eastern`, `african`, `south-asian`, `latin`, `elven`, `dwarven`, `orcish`, `draconic`, `celestial`, `infernal` |
| `nameTypes`   | `family`, `given`, `nickname` (data forms only)                                                                                                           |
| `meaningTags` | `noble`, `nature`, `dark`, `arcane`, `martial`, `serene`, `cunning`, `heroic`, `mysterious`, `pastoral`, `royal`, `wild` (may be empty)                   |

**Name order** (`CULTURE_META`): `familyFirst` = japanese, chinese; `noFamily` = orcish, draconic,
infernal (these get **no `family` names** — their quota folds the family share into `given`);
all others `givenFirst`.

**File placement**: one file per culture (`<culture>.json`); the multi-valued `genders` field on
each entry drives gender filtering. A name covering several cultures appears in each culture's
file; the dataset loader deduplicates by name at load.

## Quotas

At load time the pool is curated down to per-locale per-culture budgets
(`DEFAULT_NAME_QUOTAS` in `quota.ts`, user-configurable in Settings → Character Name Engine →
Configure name database quotas), split across name types by a global ratio (default 60/30/10)
via random sampling. Adding names beyond the quota is fine — they join the sampling pool. To
change how many names stay active, adjust the budgets (settings UI or `DEFAULT_NAME_QUOTAS`).

## Web sources (BehindTheName is the single source)

BehindTheName is statically fetchable and authoritative. `fantasynamegenerators.com` is **JS-rendered
and unusable** via static fetch — do not use it.

**Real cultures** — given-name pages and the surname site:

```
https://www.behindthename.com/names/gender/{masculine|feminine}/origin/{origin}[/{page}]
https://surnames.behindthename.com/names/origin/{origin}
```

Entry format (a large filter/form block precedes the entries):

```
[Alden](/name/alden) m [English](/names/usage/english)
From a surname that was derived from the Old English given name Ealdwine.
```

Gender marker after the link: `m` / `f` / `m & f` / `f & m`. Surname entries have **no** gender marker.

**Origin → culture mapping** (set `cultures:[<culture>]` regardless of the specific origin):

| Culture          | BehindTheName origin(s) to fetch                                |
| ---------------- | --------------------------------------------------------------- |
| `european`       | `english` (plus other European origins)                         |
| `japanese`       | `japanese`                                                      |
| `chinese`        | `chinese`                                                       |
| `middle-eastern` | `arabic`, `persian` (also `hebrew`, `turkish`)                  |
| `african`        | `yoruba`, `igbo`, `swahili`, `zulu`, `akan`, `shona`, `amharic` |
| `south-asian`    | `hindi`, `sanskrit`, `tamil`, `bengali`, `punjabi`, `urdu`      |
| `latin`          | `spanish`, `italian`, `portuguese`                              |

**Fantasy cultures** — via BehindTheName Literature / Mythology / Popular-Culture / tag pages:

| Culture     | Where the names actually live                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------ |
| `elven`     | Tolkien's Characters namesake listing (`/namesakes/category/tolkien/alpha`) + `usage/literature` |
| `dwarven`   | Tolkien namesakes + `usage/norse-mythology` (Norse-derived dwarf names)                          |
| `celestial` | `usage/judeo-christian-legend` (angels) + `usage/mythology`                                      |
| `infernal`  | `/names/tag/demons` + `usage/mythology`                                                          |
| `draconic`  | `usage/mythology` + `usage/popular-culture` (dragons/serpents)                                   |
| `orcish`    | **Very sparse** on BehindTheName (~3 names) — needs a non-BTN Tolkien orc-name source to grow    |

## Step-by-Step: Growing a culture/locale

### Step 1 — Research (delegate to keep context lean)

Pages are large (15–50KB of filter noise before the entries) and truncate to a saved file. **Delegate
fetch + extraction to a `general` agent** rather than reading pages into your own context. Give the agent
the schema, the origin→culture mapping, target counts, and the output path; have it `webfetch` the pages,
Grep the saved files for entries, classify, and **write the entries directly** (as JSON). Launch one agent
per culture in parallel for the real-world cultures.

### Step 2 — Classify into the schema (judgment rules for the agent)

- `genders`: `m`→`["masculine"]`, `f`→`["feminine"]`, `m & f`/`f & m`→`["masculine","feminine"]`, surnames→`["neutral"]`.
- `nameTypes`: given pages→`["given"]` (but `["nickname"]` if the meaning text explicitly says "nickname";
  "short form of" / "diminutive" is **not** a nickname); surname pages→`["family"]`.
- `themes`: default `["modern"]` for contemporary names; add `fantasy` for noble/royal/martial/nature/arcane/
  medieval feel; add `sci-fi` sparingly for futuristic/astronomy. Fantasy cultures are mostly `["fantasy"]`.
  A modern name with an edgy/occult/urban-fantasy feel stays `["modern"]` — capture the fantastical side with
  `meaningTags` (e.g. `arcane`, `dark`, `mysterious`) instead of a theme. Keep 1–2 themes.
- `meaningTags` (1–2, keep diverse): noble/ruler→`noble,royal`; tree/flower/animal/wood/stream/field→
  `nature,pastoral`; strong/warrior/bow/battle/brave→`martial,heroic`; bright/light/sun→`heroic`;
  dark/black/night→`dark`; wise/clever→`cunning`; peace/calm/joy→`serene`; unknown/legend/ghost→`mysterious`;
  farm/meadow→`pastoral`; magic/ancient→`arcane`; free/untamed→`wild`. Empty is allowed when nothing fits.
- Strip trailing disambiguation digits (`Aria 1`→`Aria`). Skip near-duplicate spelling variants. De-dup
  names appearing in both given and surname sources (keep as given). **Never fabricate** — report shortfalls.

### Step 3 — Append the entries

Add entries to the correct files: `src/lib/fs/<locale>/names/<culture>.json`. Before adding, check
the file for existing duplicates (names dedup kebab-case across all files of a locale). Keep the
one-entry-per-line formatting.

### Step 4 — Verify

```bash
npm run test    # dataset.test gates: no invalid entries + only real themes + dedup
npm run check   # svelte-check
npm run lint    # eslint
```

The bundled-data tests fail if any entry has a bad enum or a theme outside `NAME_THEMES`.

### Step 5 — Refresh the manifest

```bash
npm run update-manifest   # bumps only the changed JSON hashes; verify the diff touches only names files
```

Then commit (JSON data + manifest together).

## Common pitfalls

1. **BehindTheName fantasy coverage is thin.** Orcish (~3 names), and elven/dwarven have **no surname**
   entries. Report shortfalls honestly; do not fabricate. Growing orcish needs a non-BTN Tolkien source.
2. **Nicknames are sparse.** BehindTheName rarely labels a name "nickname"; "short form of"/"diminutive"
   should stay `given`. Most cultures end up with few nicknames — that is expected.
3. **`fantasynamegenerators.com` is JS-rendered** — static fetch returns only navigation chrome. Use
   BehindTheName only.
4. **Enum drift** — the runtime parser validates against the enums in `types.ts` and drops invalid
   entries loudly at load (and in tests). If you add a new culture, meaning tag, or name theme, extend the
   corresponding enum in `types.ts` first; for a new name theme also update `STORY_THEME_TO_NAME_THEME`,
   and when a new world template appears, add its mapping there (a dataset test guards this).
5. **zh-Hant-HK needs Traditional Chinese characters**, not BehindTheName's romanization. Use Chinese
   sources (e.g. 百家姓 / Hundred Family Surnames for family names, Chinese given-name sources) plus light
   transliterations for non-Chinese cultures. Chinese is `familyFirst` (composed as `王小明`).
6. **Don't store `full` names** and don't create files outside the flat `<culture>.json` layout —
   only those files are globbed and loaded.

## Tips

- **Parallelize real-world cultures** — launch one `general` agent per culture; they fetch + classify +
  write entries concurrently. Fantasy cultures need more bespoke source guidance (see table above).
- **Quotas cap what stays active** — check Settings → Character Name Engine → Configure name database
  quotas (or `DEFAULT_NAME_QUOTAS`) when a culture's pool outgrows its budget.
- **Provenance** — when research is delegated, keep the source URLs in the task summary or commit
  message so entries stay traceable.
