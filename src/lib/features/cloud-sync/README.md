# Cloud Sync

Sequential-use story synchronization across a user's own devices (Desktop App, Web App, Android). Concurrent editing is out of scope by design; correctness of merge on divergence is the core requirement.

## Architecture

```
UI layer
  settings/cloud-sync subpage   — configure backend + credentials, story selection, test, sync now
  SidebarNav.svelte             — "Sync to Cloud" button (visible when configured)
  CloudSyncOverlay.svelte       — blocking progress overlay while a sync runs (mounted in +layout.svelte)
  +layout.svelte                — "Also remove from cloud" on story deletion
State layer
  cloud-sync.svelte.ts          — reactive status/report/error store; entry points
                                  runCloudSync / testCloudSyncConnection / removeStoryFromCloudById
  backend-factory.ts            — Settings → SyncBackend (undefined = not configured)
Engine layer
  sync-engine.ts                — orchestration: pull pass → push pass → manifest last
  sync-merge.ts                 — story/act-line merge semantics (lineage comparison, fork-and-yield)
  sync-manifest.ts              — manifest schema + SHA-256 content hashing
Transport layer
  sync-backend.ts               — SyncBackend interface (testConnection/list/upload/download/delete)
  s3-backend.ts                 — S3-compatible (aws4fetch SigV4)
  webdav-backend.ts             — WebDAV (PROPFIND/MKCOL/GET/PUT/DELETE, Basic auth)
  http-client.ts                — syncFetch (plugin-http on Tauri, fetch on web) + withRetry
```

Backends know nothing about stories; all story semantics live in the engine/merge layers. Paths are relative to the backend root/prefix with `/` separators.

## Remote layout

```
<prefix>/hiyori-manifest.json
<prefix>/stories/<storyId>.hiyori.zip
```

Archives reuse the existing export format (`buildStoryArchive` from `story-export-load`). The manifest is uploaded **last** after all archives, so an interrupted sync leaves stale hashes and is re-detected as dirty on the next run.

### Manifest schema (`sync-manifest.ts`)

```json
{ "version": 1, "stories": { "<storyId>": { "name": "...", "archiveHash": "<sha256 hex>", "updatedAt": 1234567890 } } }
```

Dirty detection: local hash = `computeContentHash(JSON.stringify(exportData), storyFolderFileHashes)` — a SHA-256 over the story-data payload plus the path-sorted set of story-folder file hashes, deterministic regardless of enumeration order. A story is pushed when its local hash differs from the manifest entry (or has no entry); a story is pulled when the manifest hash differs from the locally computed hash.

## Sync flow (`sync-engine.ts`)

1. Download manifest (absent → empty manifest, first-ever sync).
2. **Pull pass**: for each manifest entry whose hash differs from local, download the archive and `mergeIncomingStory()`.
3. **Push pass**: for each local story whose hash differs from the (post-pull) manifest, build and upload the archive.
4. Upload the merged manifest last.

Stories listed in `settings.cloudSync.excludedStoryIds` are skipped in both pull and push passes (opt-out; new stories sync by default) and removed from cloud storage in a removal pass — exclusion means "not in the cloud". If a removal fails, the story's manifest entry is carried over so the removal is retried on the next sync. Conversely, deleting a story with "Also remove from cloud" adds its id to `excludedStoryIds` so another device pushing it cannot resurrect it locally. `syncNow()` reports progress per story via an optional `onProgress` callback (`CloudSyncOverlay` displays it).

`removeStoryFromCloud()` deletes the archive object and its manifest entry.

## Conflict resolution (`sync-merge.ts`)

### Messages are practically immutable — add-only rule

Incoming messages whose IDs already exist locally are never overwritten. Merge only inserts absent message IDs.

### Lineage comparison — four cases

Each act line's lineage is the chain of message IDs. `compareLineages(local, incoming)` decides:

| Case           | Condition                            | Action                              |
| -------------- | ------------------------------------ | ----------------------------------- |
| `identical`    | same sequence                        | overlay incoming line-local state (no-op when nothing to import) |
| `remote-stale` | incoming is a strict prefix of local | silent no-op                        |
| `local-stale`  | local is a strict prefix of incoming | fast-forward (delete local copy, import incoming) |
| `divergent`    | neither is a prefix of the other     | fork-and-yield                      |

### Fork-and-yield (divergent case)

Incoming progress takes over the original act-line ID (so references, UI selection, and downstream acts keep pointing at the canonical line); local progress is preserved as a new fork act line. Worked example — line `0001 → 0002 → 0003` diverges after `m2`:

- Local lineage: `m1, m2, m3, m4`
- Incoming lineage: `m1, m2, m5, m6`

Steps in `mergeIncomingActLine`:

1. Incoming-only messages (`m5`, `m6`) are inserted (add-only rule skips `m1`, `m2`).
2. The local line is forked with the app's canonical `branchFromLine()`: junction entries are copied with their original sequences, the fork-point message is cloned (new id, same content — matching in-app forks so metadata writes on either line can't pollute the other), and premises and events are carried over. The rest of the in-app `forkActLine()` workflow then runs: director notes, character profiles (up to the fork scene) and inventory are cloned onto the fork; on desktop, memory indices are copied too (same `isMemoryAvailable()` guard as in-app forks).
3. The original line is deleted wholesale with `deleteActLine()` — junction rows, premises, events, notes, profiles, inventory and metadata. Message rows no longer referenced by any line are orphan-cleansed; the fork's junction rows keep the local-branch messages alive (and the fork-point message's content survives in its clone).
4. The incoming act line is imported onto the original line ID (`insertSelectedActLineData` semantics): the incoming metadata replaces the local meta (whose name survives, renamed, on the fork), the incoming entries (`m1, m2, m5, m6`) are linked, and the incoming line-local state — events, premises, director notes, character profiles — is inserted. References, UI selection and downstream acts keep pointing at the canonical line. Message rows stay add-only: they are shared with the fork, and overwriting them would corrupt the fork's view of the same rows.

Fork insertion happens **before** removing entries from the yielded line so shared messages are never momentarily orphaned.

### Fast-forward (local-stale case)

The local copy of the line is deleted via `deleteActLine()` and the incoming act line is imported wholesale onto the same line ID — the same delete-and-import the divergent case performs, minus the fork. Add-only message insertion runs **after** the delete, so rows referenced only by the deleted line are re-created from the archive; rows still referenced by another local line are untouched. All incoming line-local state (events, premises, director notes, character profiles) lands on the line.

Fast-forward only runs when the incoming archive is a true superset: besides the message-chain prefix check, the local line's line-local state (events, premises, director notes, character profiles) must all exist in the incoming archive. `compareLineages` only sees message IDs, so a note added locally after the last sync is an invisible deviation — when the subset check fails, the merge **escalates to fork-and-yield** and the local state survives on the fork instead of being destroyed.

### Identical lineage

Equal message chains mean neither side supersedes the other, so incoming line-local state is unioned into the line by row identity (nothing is deleted or overwritten; messages stay add-only). A pull with nothing to import is a no-op.

New stories absent locally are imported whole via `loadStoryOverwrite` — IDs are preserved deliberately; synced stories must never pass through the ID remapper (`loadStoryAsNew`/`regenerateIds`) or cross-device identity breaks.

## Backend notes

### S3 (`s3-backend.ts`)

- Path-style URLs (`https://<endpoint>/<bucket>/<key>`), works with Cloudflare R2, MinIO, etc.
- Signing via **aws4fetch** `AwsClient.sign()`; signed requests route through `syncFetch`.
- **Pitfall (regression-tested):** aws4fetch drops the request body during signing when no `Content-Type` header is present. Uploads must use `new Blob([...], { type: 'application/octet-stream' })`.
- `list()` paginates ListObjectsV2 (`IsTruncated` / `NextContinuationToken`, 1000-key cap).

### WebDAV (`webdav-backend.ts`)

- `PROPFIND` with `Depth: 1`, multistatus parsed via `DOMParser` + `getElementsByTagNameNS('DAV:', ...)`.
- `MKCOL` before uploads; `405 Method Not Allowed` is tolerated as "collection already exists".
- Basic auth with unicode-safe base64 (`TextEncoder` → per-byte `String.fromCharCode`).

## Platform differences (`http-client.ts`)

- **Tauri (desktop/Android):** requests go through `@tauri-apps/plugin-http`, which bypasses webview CORS — user-configured WebDAV/S3 servers cannot be expected to send CORS headers for desktop apps.
- **Web:** plain `fetch` by default. The deployment must allow the backend origin in CSP `connect-src`, and the remote server must send CORS headers for the web origin. Alternatively, `settings.cloudSync.corsBypassEnabled` routes requests through a WISP proxy (`wispProxyUrl`) using the libcurl fetch from `$lib/http/fetch.ts` — the same mechanism provider API calls use. The libcurl fetch is cached after first init, so a changed proxy URL takes effect after reload.

## Security notes

Credentials are stored in `settings.cloudSync` (localStorage / settings persistence, same trust boundary as provider API keys). An `http://` (plaintext) endpoint transmits credentials unencrypted — the UI does not block it, but users should only configure `https://` endpoints outside trusted local networks.

## Known limitations

- Synced-story forks reuse `branchFromLine()`, so the fork's fork-point message is a clone with a new id (same as in-app forks); any external tooling that assumes the fork shares every message id with the original line will see one differing id at the fork point.
- Story-folder files sync only alongside database changes: when a pull merges incoming messages, the archive's folder files are applied locally. Folder-file-only edits on one device are detected as dirty and pushed, but a receiving device applies them only on its next pull that also carries DB changes — protecting newer local file edits from stale archives.
- Fast-forward is gated by a state-subset check: any local line-local state the incoming archive lacks escalates the merge to fork-and-yield. Message *content* edits on the shared prefix are not compared — when rows are orphan-cleansed they are re-created from the archive's copy (rows shared with other local lines remain add-only).
- Act lines created on another device are imported with their messages and junction entries only — their events, premises, director notes, and character profiles are not imported (the new-story path imports them in full). Known follow-up.
- Sync is manual (Sync now / sidebar button); there is no background or automatic sync.
- Deleting a story locally without "Also remove from cloud" leaves its archive and manifest entry in the cloud; the next sync on this device will pull it back. Use the delete-dialog checkbox to remove it permanently — it also excludes the story id from future syncs, so another device cannot resurrect it here.
