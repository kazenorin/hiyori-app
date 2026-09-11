---
name: prune-config-manifest
description: 'Collapse config-assets-manifest.yaml churn against the latest release tag so the committed diff contains only real asset changes. Use when: (1) A task finished that edited bundled prompts, view-templates, names, or locale-strings, (2) The manifest diff shows entries differing only in updatedAt, (3) oldHashes lists accumulated post-release revisions from repeated update-manifest runs. Triggers on: "prune manifest", "clean manifest", "config-assets-manifest", "manifest churn", "revert manifest updatedAt", "update-manifest timestamp noise", "release prep".'
---

## Overview

`src/lib/fs/config-assets-manifest.yaml` records a `hash`, an `oldHashes` history and an `updatedAt` stamp for every bundled config asset. Each `npm run update-manifest` prepends the previous hash to `oldHashes` and re-stamps the entries whose hash changed. Repeated runs inside one release cycle therefore accumulate two kinds of noise: dead intermediate `oldHashes` entries (content revisions that never shipped and no longer exist) and `updatedAt` values that have drifted past the moment the asset content actually changed.

**Pruning** rebuilds the manifest from the newest release tag as the baseline, so the result records exactly one transition per changed asset: *tag version → current version*. It is a closing step for any task that touched manifest sources.

## When to run

Run at the end of a task whose diff touches any of these (the full hashed set, from `collectSourceFiles()` in `scripts/update-config-manifest.mjs`):

| Source | Manifest `configPath` prefix |
| --- | --- |
| `src/lib/fs/{en,zh-Hant-HK}/prompts/**` | `<locale>/prompt-templates/` |
| `src/lib/fs/{en,zh-Hant-HK}/view-templates/**` | `<locale>/view-templates/` |
| `src/lib/fs/{en,zh-Hant-HK}/names/**` | `<locale>/names/` |
| `src/lib/fs/locale-strings/{en,zh-Hant-HK}.yaml` | `<locale>/locale-strings.yaml` |

Skip it when a task touched none of those — the manifest needs no maintenance on code-only changes.

## The three-step procedure

The anchor tag governs Step 1 only; Step 3 compares against the last committed manifest. Commands are PowerShell; in bash use `tag=$(...)` and `&&` separators.

```powershell
# Step 0 — anchor: newest tag by date. Lightweight tags in this repo resolve straight to a commit.
$tag = git for-each-ref --sort=-creatordate --format='%(refname:short)' --count 1 refs/tags
echo "anchor: $tag"

# Step 1 — reset the manifest to the anchor state (discards accumulated oldHashes + stamps).
git checkout $tag -- src/lib/fs/config-assets-manifest.yaml

# Step 2 — regenerate against the current asset files.
npm run update-manifest

# Step 3 — restore the stamp on every entry whose content is unchanged since the base ref.
node scripts/revert-manifest-updated-at.mjs
```

Leave Step 3 on its default `--ref HEAD`. Name a ref explicitly only when the cleanup was already committed — `HEAD` is then the pruned state and the accurate stamps sit in an earlier commit, so step back until `git log --oneline -- src/lib/fs/config-assets-manifest.yaml` shows a ref that still carries them.

`--count 1` is required; this Git build rejects the `-n` short form. `git describe --tags --abbrev=0` is an ancestry-based cross-check that legitimately disagrees when the newest tag is not an ancestor of `HEAD` — prefer the date-sorted form, which is what "latest release" means here.

## Why each step behaves as it does

- **Step 2 is selective.** `update-config-manifest.mjs` skips entries whose recomputed hash equals the recorded one (`if (existing.hash === newHash) continue`), so unchanged assets keep their anchor-era `updatedAt`. Deleting an asset sets `hash: null` and moves the old hash into `oldHashes`.
- **Step 3 needs the committed manifest as its base, and the anchor tag can never provide one.** Against a tag base the step is a provably empty operation: after Step 2, each entry either differs from the tag in `hash` (a real change, so it should keep the new stamp) or does not differ at all (in which case Step 2 left its stamp alone). Only a base near `HEAD` can see the stamp damage Steps 1–2 inflict on assets whose current revision was already committed earlier in the cycle.
- **The revert criterion is `hash` alone.** A stamp is restored whenever the recomputed `hash` equals the base's, even though Step 1 rewrote that entry's `oldHashes`. `hash` pins the bundled bytes, so a pruned history is not a content change and must not advance the timestamp.
- **`updatedAt` has no runtime consumer.** It is parsed into `ConfigAssetEntry` in `src/lib/fs/config-manifest.ts` and never read; sync and export decisions use only `hash` / `oldHashes` via `isContentUserEdited()`. The field is reviewer-facing provenance, so an inaccurate stamp is a documentation defect rather than a behavior bug — and accuracy is the only thing Step 3 exists to protect.
- **Hashing is whitespace-tolerant.** `hashFile()` converts CRLF to LF and trims before hashing, so a trailing-newline-only edit prints `Manifest up to date, no changes.` and rewrites nothing.

## Verification before reporting done

```powershell
# Tests must be fully green: stale hashes make these two list-user-changed cases fail.
npx vitest run src/lib/__tests__/config-manifest.test.ts

# The diff should be signal only: oldHashes deletions, plus hash/stamp changes for assets genuinely edited.
git diff HEAD -- src/lib/fs/config-assets-manifest.yaml

# Line endings must still be pure LF; the revert script splits/joins on \n.
node -e "const b=require('fs').readFileSync('src/lib/fs/config-assets-manifest.yaml','utf-8'); console.log('CRLF:',(b.match(/\r\n/g)||[]).length,'| bare LF:',(b.match(/(?<!\r)\n/g)||[]).length,'| trailing newline:',b.endsWith('\n'));"
```

Expect `27 passed`, no CRLF, and no `updatedAt` line in the diff for any entry whose `hash` is unchanged — when the manifest was committed before pruning, the surviving diff is `oldHashes` deletions only. `git status` shows `MM` for the manifest: Step 1 staged the anchor snapshot, Steps 2–3 rewrote the worktree. Stage the worktree version before committing:

```powershell
git add src/lib/fs/config-assets-manifest.yaml
```

Never hand-edit the manifest; it is generated, and the `--ref` comparison in Step 3 depends on it matching the script output byte-for-byte.

## Safety check on pruned history

`oldHashes` is load-bearing: `isContentUserEdited()` in `src/lib/fs/config-manifest.ts` (and `src/lib/db/data-portability.ts`) treats a local file matching any listed hash as pristine, allowing `syncConfigAssets` to overwrite it. Dropping a hash means a user holding that exact revision is classified as user-edited and keeps a stale copy.

Pruning is safe when the dropped revisions never shipped, which holds by construction for the newest tag — the pruned entries are post-anchor work. Surface an exception before proceeding if a build was distributed from an unreleased branch that carried them (e.g. a `release-1.9.0` or beta branch containing the commits whose hashes are being dropped); then keep those hashes and report why. Confirm membership with:

```powershell
git merge-base --is-ancestor <commit> $tag
```

## Reporting

After the steps, state: the anchor tag used for Step 1, the base ref Step 3 compared against, how many stamps it restored and which entries kept a new stamp because their `hash` genuinely differs from that base, the reduced `+N/-M` diff size versus before pruning, and the test result. Do not claim the manifest is clean without the `git diff HEAD` output above.
