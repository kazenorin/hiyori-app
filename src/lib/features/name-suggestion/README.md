# Name Suggestion (Analytic Mode)

A curated, non-LLM name database backing the Analytic Mode of the
`suggest-character-name` tool. Names are categorized and tagged so the tool can
filter deterministically without a model call.

## Data layout

Names live in CSV files under `src/lib/fs/<locale>/names/` (e.g.
`src/lib/fs/en/names/`, `src/lib/fs/zh-Hant-HK/names/`), alongside the prompt and
view-template assets. They are managed by the config-asset system:

- **Bundled** at build time and tracked by the config manifest
  (`config-assets-manifest.yaml`) — run `npm run update-manifest` after changing
  bundled CSVs.
- **Seeded** to AppData at `config/<locale>/names/` on launch, where users can
  edit them (user override). Edits are detected by hash and never overwritten by
  the config sync.
- **Loaded** with AppData override → bundled fallback.

Each locale has three fixed files — `masculine.csv`, `feminine.csv`, and
`neutral.csv` — which are loaded by name (no directory globbing) and merged.
Place a name in `masculine.csv` if it is purely masculine, `feminine.csv` if
purely feminine, and `neutral.csv` if it is neutral or suits multiple genders.
The multi-valued `gender` column remains the source of truth for filtering, so a
unisex name in `neutral.csv` can still carry `masculine;feminine`.

`getNameDataset(locale)` (async) loads the files for a locale and falls back to
`en` when a locale has no data.

### Columns

```
name,gender,themes,cultures,nameTypes,meaningTags
Aragorn,masculine,high-fantasy,european,given,noble;royal;martial
```

| Column        | Required | Cardinality | Values |
| ------------- | -------- | ----------- | ------ |
| `name`        | yes      | single      | Free text. The suggested name. |
| `gender`      | yes      | multi       | `masculine`, `feminine`, `neutral`. Use multiple (e.g. `masculine;feminine`) for names usable across genders; `neutral` for gender-agnostic. |
| `themes`      | yes      | multi       | World-template ids: `high-fantasy`, `modern-slice-of-life`, `sci-fi`, `urban-fantasy`. Must mirror `WORLD_TEMPLATES`. |
| `cultures`    | yes      | multi       | See `CULTURES` in [`types.ts`](./types.ts). |
| `nameTypes`   | yes      | multi       | `family`, `given`, `nickname` (data forms only — see below). |
| `meaningTags` | no       | multi       | Connotation tags. See `MEANING_TAGS` in [`types.ts`](./types.ts). |

- Multi-valued fields are separated by `;` (not `,`, which is the CSV delimiter).
- The first row is a header and is skipped.
- Fields containing commas may be double-quoted; escape a quote as `""`.
- Embedded newlines are **not** supported — keep one name per line.

### Name types: data vs. tool

The data stores three forms:

- `given` — a first/forename (e.g. `Aria`, `小明`).
- `family` — a surname (e.g. `Thornwood`, `王`).
- `nickname` — a casual name or mononym (e.g. `Sparrow`, `阿明`).

The tool accepts those three **plus** `full`. `full` is never stored — it is
**composed** at query time by pairing a culture-compatible `given` entry with a
`family` entry. Omitting `nameTypes` returns the direct forms only (no
composition).

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

Users edit the AppData copies at `config/<locale>/names/*.csv`. To grow the
bundled defaults, append rows to (or add a new `*.csv` file under) the relevant
`src/lib/fs/<locale>/names/` directory, then run `npm run update-manifest`.
Values for `gender`, `cultures`, `nameTypes`, and `meaningTags` must match the
enums in [`types.ts`](./types.ts); invalid rows are skipped and logged at load.
To add a new culture or meaning tag, extend the corresponding enum in `types.ts`
first.

## Loading

`getNameDataset(locale)` in [`dataset.ts`](./dataset.ts) is async: it reads each
name CSV for the locale through the file system (AppData override → bundled
default, via [`fs/names.ts`](../../fs/names.ts)), then parses and merges them.
Files are read fresh on each call so user edits take effect without a restart.
The data is small (~1000 entries), so no persistent cache is needed.
