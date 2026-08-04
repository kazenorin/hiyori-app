# Name Suggestion (Analytic Mode)

A curated, non-LLM name database backing the Analytic Mode of the
`suggest-character-name` tool. Names are categorized and tagged so the tool can
filter deterministically without a model call.

## Data layout

Names live in JSON files under `src/lib/fs/<locale>/names/`, one file per
culture (e.g. `src/lib/fs/en/names/european.json`), alongside the prompt and
view-template assets. They are managed by the config-asset system:

- **Bundled** at build time and tracked by the config manifest
  (`config-assets-manifest.yaml`) — run `npm run update-manifest` after changing
  bundled files.
- **Seeded** to AppData at `config/<locale>/names/` on launch, where users can
  edit them (user override). Edits are detected by hash and never overwritten by
  the config sync.
- **Loaded** with AppData override → bundled fallback.

Each file is a JSON array of entries for one culture; the multi-valued
`genders` field on each entry is the source of truth for gender filtering. A
name covering several cultures appears in each culture's file; the dataset
loader deduplicates by name. Locales missing a culture file that exists in
another locale are seeded with `[]` so users have a place to add names.

`getNameDataset(locale)` (async) loads and deduplicates the files for a locale,
curates them down to the configured quotas (see below), and falls back to `en`
when a locale has no data. `getNameDatasetPool(locale)` returns the full
deduplicated pool without quota curation (used for quota previews).

### Entry shape

```json
{
	"name": "Aragorn",
	"genders": ["masculine"],
	"themes": ["fantasy"],
	"cultures": ["european"],
	"nameTypes": ["given"],
	"meaningTags": ["noble", "royal", "martial"]
}
```

| Field         | Required | Values |
| ------------- | -------- | ------ |
| `name`        | yes      | Free text. The suggested name. |
| `genders`     | yes      | `masculine`, `feminine`, `neutral`. Use multiple for names usable across genders; `neutral` for gender-agnostic. |
| `themes`      | yes      | Consolidated name themes: `fantasy`, `modern`, `sci-fi` (see `NAME_THEMES`). |
| `cultures`    | yes      | See `CULTURES` in [`types.ts`](./types.ts). |
| `nameTypes`   | yes      | `family`, `given`, `nickname` (data forms only — see below). |
| `meaningTags` | no       | Connotation tags. See `MEANING_TAGS` in [`types.ts`](./types.ts). |

Invalid entries are skipped and logged at load without aborting the whole file.

### Name types: data vs. tool

The data stores three forms:

- `given` — a first/forename (e.g. `Aria`, `小明`).
- `family` — a surname (e.g. `Thornwood`, `王`).
- `nickname` — a casual name or mononym (e.g. `Sparrow`, `阿明`).

The tool accepts those three **plus** `full`. `full` is never stored — it is
**composed** at query time by pairing a culture-compatible `given` entry with a
`family` entry. Omitting `nameTypes` returns the direct forms only (no
composition).

### Themes: story vs. dataset

The dataset uses a consolidated three-value vocabulary (`NAME_THEMES`):
`fantasy`, `modern`, and `sci-fi`. Story themes (world-template ids) are mapped
onto it at the tool boundary (`STORY_THEME_TO_NAME_THEME` / `toNameThemes`):

| Story theme             | Name theme |
| ----------------------- | ---------- |
| `high-fantasy`          | `fantasy`  |
| `modern-slice-of-life`  | `modern`   |
| `urban-fantasy`         | `modern`   |
| `sci-fi`                | `sci-fi`   |

Urban-fantasy names sit under `modern`; their fantastical side is carried by
`meaningTags` (e.g. `arcane`, `dark`, `mysterious`) rather than a separate
theme. The tool's input schema still accepts story themes, so the LLM-facing
vocabulary matches the story's world template.

## Quotas

The full pool is curated down to configurable quotas at load time
([`quota.ts`](./quota.ts), settings key `nameSuggestionQuotas`, editable under
Settings → Character Name Engine → Configure name database quotas):

- **Per-locale per-culture budgets** — the total number of names kept for each
  culture (defaults mirror the budgets the original CSV generator shipped).
- **Global name-type ratio** — how each culture's budget splits across
  `given` / `family` / `nickname` (default 60/30/10; values are relative weights
  and normalized). Cultures without family names (`noFamily` in `CULTURE_META`)
  fold the family share into given names.

Entries are grouped by (culture, nameType); each group keeps at most its quota,
chosen by random sampling (`rng` injectable for deterministic tests). Counts are
deterministic (`min(available, quota)`); membership varies per call. Locales
without budgets of their own resolve to the `en` budgets.

## Full-name composition

Composition respects each culture's ordering (`CULTURE_META` in
[`types.ts`](./types.ts)):

- `givenFirst` (e.g. european, elven) → given + family.
- `familyFirst` (e.g. chinese, japanese) → family + given.
- `noFamily` (e.g. orcish, draconic, infernal) → cannot compose; skipped.

The join separator is locale-aware: in `zh-Hant-HK`, a `givenFirst`
transliteration uses the dot character (`湯姆·索亞`), while a `familyFirst`
native name uses no separator (`王小明`); other locales use a space. Family-name
selection ignores the gender filter (surnames are shared); the given name carries
gender. A composed name's `meaningTags` are the union of both parts.

## Avoiding existing names

The tool's `avoidanceLevel` (0–5, default 3) controls how strongly names already
in the database are avoided: a colliding candidate is rejected with probability
`avoidanceLevel / 5` (0 = never avoid, 5 = always avoid). Use a higher level for
important characters and a lower level for minor ones.

## Adding names

Users edit the AppData copies at `config/<locale>/names/<culture>.json`. To
grow the bundled defaults, append entries to the relevant
`src/lib/fs/<locale>/names/<culture>.json` file, then run
`npm run update-manifest`. Values for `genders`, `themes`, `cultures`,
`nameTypes`, and `meaningTags` must match the enums in
[`types.ts`](./types.ts); invalid entries are skipped and logged at load. To add
a new culture or meaning tag, extend the corresponding enum in `types.ts` first.

## Loading

`getNameDataset(locale)` in [`dataset.ts`](./dataset.ts) is async: it reads each
name file for the locale through the file system (AppData override → bundled
default, via [`fs/names.ts`](../../fs/names.ts)), parses, deduplicates, and
applies quotas. Files are read fresh on each call so user edits take effect
without a restart. The data is small (~1000 entries), so no persistent cache is
needed.
