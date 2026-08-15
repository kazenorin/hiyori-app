# Cloud Sync

Sequential-use story synchronization across a user's own devices (Desktop App, Web App, Android). Concurrent editing is out of scope by design; correctness of merge on divergence is the core requirement.

## Architecture

```
UI layer
  settings/cloud-sync subpage   — configure backend + credentials, test, sync now
  SidebarNav.svelte             — "Sync to Cloud" button (visible when configured)
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

`removeStoryFromCloud()` deletes the archive object and its manifest entry.

## Conflict resolution (`sync-merge.ts`)

### Messages are practically immutable — add-only rule

Incoming messages whose IDs already exist locally are never overwritten. Merge only inserts absent message IDs.

### Lineage comparison — four cases

Each act line's lineage is the chain of message IDs. `compareLineages(local, incoming)` decides:

| Case | Condition | Action |
| --- | --- | --- |
| `identical` | same sequence | no-op |
| `remote-stale` | incoming is a strict prefix of local | silent no-op |
| `local-stale` | local is a strict prefix of incoming | fast-forward (append incoming tail) |
| `divergent` | neither is a prefix of the other | fork-and-yield |

### Fork-and-yield (divergent case)

Incoming progress takes over the original act-line ID (so references, UI selection, and downstream acts keep pointing at the canonical line); local progress is preserved as a new fork act line. Worked example — line `0001 → 0002 → 0003` diverges after `m2`:

- Local lineage: `m1, m2, m3, m4`
- Incoming lineage: `m1, m2, m5, m6`

Steps in `mergeIncomingActLine`:
1. Incoming-only messages (`m5`, `m6`) are inserted (add-only rule skips `m1`, `m2`).
2. A new fork act line is created for the same act.
3. The local divergent messages (`m3`, `m4`) are re-linked to the fork line (junction rows moved; message rows survive because `removeMessagesFromActLine` only deletes when no other line references them).
4. The incoming entries (`m1, m2, m5, m6`) are linked to the original act line.

Fork insertion happens **before** removing entries from the yielded line so shared messages are never momentarily orphaned.

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
- **Web:** plain `fetch`. The deployment must allow the backend origin in CSP `connect-src`, and the remote server must send CORS headers for the web origin. This is a documented deployment requirement, not handled in code.

## Security notes

Credentials are stored in `settings.cloudSync` (localStorage / settings persistence, same trust boundary as provider API keys). An `http://` (plaintext) endpoint transmits credentials unencrypted — the UI does not block it, but users should only configure `https://` endpoints outside trusted local networks.

## Known limitations

- Act-line premises and event metadata are not carried over when a divergent line is forked; the fork preserves messages and junction ordering only.
- Sync is manual (Sync now / sidebar button); there is no background or automatic sync.
- A story deleted locally without "Also remove from cloud" will reappear on the next pull from another device's manifest only if that device re-pushes it; its archive stays in the cloud until removed explicitly.
