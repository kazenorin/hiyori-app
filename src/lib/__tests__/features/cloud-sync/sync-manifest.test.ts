import { describe, it, expect } from 'vitest';
import { emptyManifest, computeContentHash, type SyncManifest } from '$lib/features/cloud-sync/sync-manifest';

describe('sync-manifest', () => {
	it('emptyManifest has no stories', () => {
		expect(emptyManifest()).toEqual({ version: 1, stories: {} });
	});

	it('hash is stable regardless of file order', async () => {
		const a = await computeContentHash('payload', [
			{ path: 'b.md', hash: '2' },
			{ path: 'a.md', hash: '1' },
		]);
		const b = await computeContentHash('payload', [
			{ path: 'a.md', hash: '1' },
			{ path: 'b.md', hash: '2' },
		]);
		expect(a).toBe(b);
	});

	// WHY: dirty detection must react to BOTH db-side changes (story-data.json)
	// and file-side changes (prompts edited on disk). Either alone misses edits.
	it('hash changes when either the payload or a file hash changes', async () => {
		const files = [{ path: 'a.md', hash: '1' }];
		const base = await computeContentHash('payload', files);
		expect(await computeContentHash('payload-changed', files)).not.toBe(base);
		expect(await computeContentHash('payload', [{ path: 'a.md', hash: '2' }])).not.toBe(base);
	});

	it('manifest entries round-trip through JSON', () => {
		const manifest: SyncManifest = {
			version: 1,
			stories: { s1: { name: 'Story', archiveHash: 'abc', updatedAt: 123 } },
		};
		expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
	});
});
