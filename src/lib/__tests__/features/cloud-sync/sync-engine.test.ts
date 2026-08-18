import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/db/stories', () => ({
	getAllStories: vi.fn(),
}));

vi.mock('$lib/features/story-export-load/story-exporter', () => ({
	buildStoryExportData: vi.fn(),
	buildStoryArchive: vi.fn(),
}));

vi.mock('$lib/features/cloud-sync/sync-merge', () => ({
	mergeIncomingStory: vi.fn(),
}));

// Folder hashing is bypassed by returning no folder — computeLocalStoryHash
// then hashes only the export payload, which tests can reproduce exactly.
vi.mock('$lib/db/story-folders', () => ({
	getStoryFolderInfo: vi.fn(async () => null),
}));
vi.mock('$lib/fs/file-tree', () => ({
	collectFilesInDir: vi.fn(async () => []),
}));
vi.mock('$lib/fs/file-system', () => ({
	fs: { exists: vi.fn(async () => false), readBinaryFile: vi.fn() },
}));

import { NotFoundError, type SyncBackend } from '$lib/features/cloud-sync/sync-backend';
import { syncNow, MANIFEST_PATH, type SyncProgress } from '$lib/features/cloud-sync/sync-engine';
import { computeContentHash } from '$lib/features/cloud-sync/sync-manifest';
import { getAllStories, type Story } from '$lib/db/stories';
import { buildStoryExportData, buildStoryArchive } from '$lib/features/story-export-load/story-exporter';
import { mergeIncomingStory } from '$lib/features/cloud-sync/sync-merge';

const mockedStories = vi.mocked(getAllStories);
const mockedExportData = vi.mocked(buildStoryExportData);
const mockedArchive = vi.mocked(buildStoryArchive);
const mockedMerge = vi.mocked(mergeIncomingStory);

function story(id: string, name: string): Story {
	return { id, name, locale: 'en', createdAt: 0, updatedAt: 0 };
}

function fakeBackend(files: Record<string, Uint8Array>): SyncBackend & {
	store: Record<string, Uint8Array>;
	uploadOrder: string[];
} {
	const store = { ...files };
	const uploadOrder: string[] = [];
	return {
		store,
		uploadOrder,
		testConnection: vi.fn(),
		list: vi.fn(async (prefix) =>
			Object.entries(store)
				.filter(([path]) => path.startsWith(prefix))
				.map(([path, data]) => ({ path, size: data.length }))
		),
		upload: vi.fn(async (path, data) => {
			store[path] = data;
			uploadOrder.push(path);
		}),
		download: vi.fn(async (path) => {
			const data = store[path];
			if (!data) throw new NotFoundError(path);
			return data;
		}),
		delete: vi.fn(async (path) => void delete store[path]),
	};
}

function manifestJson(stories: Record<string, { name: string; archiveHash: string }>): Uint8Array {
	const manifest = {
		version: 1,
		stories: Object.fromEntries(
			Object.entries(stories).map(([id, e]) => [id, { ...e, updatedAt: 0 }])
		),
	};
	return new TextEncoder().encode(JSON.stringify(manifest));
}

describe('syncNow', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// WHY: a device with nothing remote must not wipe local stories —
	// pull is additive/merge-only by design.
	it('does not delete local stories when remote manifest is absent', async () => {
		mockedStories.mockResolvedValue([story('s1', 'Story 1')]);
		mockedExportData.mockResolvedValue({ marker: 'local' } as never);
		mockedArchive.mockResolvedValue({ data: new Uint8Array([9]), filename: 'x.zip' } as never);
		const backend = fakeBackend({});

		const report = await syncNow(backend);

		expect(backend.delete).not.toHaveBeenCalled();
		expect(report.errors).toEqual([]);
		const uploaded = JSON.parse(new TextDecoder().decode(backend.store[MANIFEST_PATH]));
		expect(Object.keys(uploaded.stories)).toEqual(['s1']);
	});

	it('downloads and merges a remote story missing locally', async () => {
		mockedStories.mockResolvedValue([]);
		mockedExportData.mockResolvedValue({} as never);
		mockedMerge.mockResolvedValue('new-story');
		const archiveBytes = new Uint8Array([1, 2, 3]);
		const backend = fakeBackend({
			[MANIFEST_PATH]: manifestJson({ s2: { name: 'Remote Story', archiveHash: 'whatever' } }),
			'stories/s2.hiyori.zip': archiveBytes,
		});

		const report = await syncNow(backend);

		expect(mockedMerge).toHaveBeenCalledWith(archiveBytes);
		expect(report.entries.some((e) => e.storyId === 's2' && e.action === 'pulled-new')).toBe(true);
	});

	it('skips stories whose hashes match', async () => {
		const exportData = { marker: 'stable' };
		const matchingHash = await computeContentHash(JSON.stringify(exportData), []);
		mockedStories.mockResolvedValue([story('s1', 'Story 1')]);
		mockedExportData.mockResolvedValue(exportData as never);
		const backend = fakeBackend({
			[MANIFEST_PATH]: manifestJson({ s1: { name: 'Story 1', archiveHash: matchingHash } }),
			'stories/s1.hiyori.zip': new Uint8Array([7]),
		});

		const report = await syncNow(backend);

		// WHY: hash equality is the bandwidth guard — re-downloading unchanged
		// archives on every sync would make the feature unusable on mobile data.
		expect(backend.download).toHaveBeenCalledTimes(1); // manifest only
		expect(mockedMerge).not.toHaveBeenCalled();
		expect(mockedArchive).not.toHaveBeenCalled();
		expect(report.entries.every((e) => e.action === 'skipped')).toBe(true);
	});

	it('pushes locally dirty stories and uploads the manifest last', async () => {
		mockedStories.mockResolvedValue([story('s1', 'Story 1')]);
		mockedExportData.mockResolvedValue({ marker: 'dirty' } as never);
		mockedArchive.mockResolvedValue({ data: new Uint8Array([5, 5]), filename: 'x.zip' } as never);
		const backend = fakeBackend({
			[MANIFEST_PATH]: manifestJson({ s1: { name: 'Story 1', archiveHash: 'stale-hash' } }),
		});

		const report = await syncNow(backend);

		expect(mockedArchive).toHaveBeenCalledWith('s1');
		expect(report.entries.some((e) => e.action === 'pushed')).toBe(true);
		// WHY: manifest-last ordering means an interrupted sync re-detects the
		// dirty story next run instead of believing a stale archive is current.
		expect(backend.uploadOrder[backend.uploadOrder.length - 1]).toBe(MANIFEST_PATH);
	});

	// WHY (W2 regression): a transient manifest download failure must not be
	// treated as "remote is empty" — the push pass would silently overwrite
	// newer remote archives with stale local ones.
	it('aborts without uploading when the manifest download fails for a non-404 reason', async () => {
		mockedStories.mockResolvedValue([story('s1', 'Story 1')]);
		mockedExportData.mockResolvedValue({ marker: 'dirty' } as never);
		mockedArchive.mockResolvedValue({ data: new Uint8Array([5, 5]), filename: 'x.zip' } as never);
		const backend = fakeBackend({});
		(backend.download as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network down'));

		const report = await syncNow(backend);

		expect(report.errors).toHaveLength(1);
		expect(report.errors[0]).toContain('Sync aborted');
		expect(backend.upload).not.toHaveBeenCalled();
	});
});

describe('syncNow story exclusion', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function excludedBackend() {
		mockedStories.mockResolvedValue([story('s1', 'Synced'), story('s2', 'Excluded Local')]);
		mockedExportData.mockResolvedValue({ marker: 'dirty' } as never);
		mockedArchive.mockResolvedValue({ data: new Uint8Array([1]), filename: 'x.zip' } as never);
		mockedMerge.mockResolvedValue('merged');
		return fakeBackend({
			[MANIFEST_PATH]: manifestJson({
				s1: { name: 'Synced', archiveHash: 'stale-1' },
				s2: { name: 'Excluded Local', archiveHash: 'remote-2' },
				s3: { name: 'Excluded Remote', archiveHash: 'remote-3' },
			}),
			'stories/s1.hiyori.zip': new Uint8Array([1]),
			'stories/s2.hiyori.zip': new Uint8Array([2]),
			'stories/s3.hiyori.zip': new Uint8Array([3]),
		});
	}

	// WHY: exclusion is a user opt-out and must hold in both directions —
	// pulling an excluded story would overwrite local state against the user's intent.
	it('excludes stories from both pull and push passes', async () => {
		const backend = excludedBackend();

		const report = await syncNow(backend, { excludedStoryIds: ['s2', 's3'] });

		expect(mockedArchive).toHaveBeenCalledWith('s1');
		expect(mockedArchive).not.toHaveBeenCalledWith('s2');
		expect(backend.download).toHaveBeenCalledWith('stories/s1.hiyori.zip');
		expect(backend.download).not.toHaveBeenCalledWith('stories/s2.hiyori.zip');
		expect(backend.download).not.toHaveBeenCalledWith('stories/s3.hiyori.zip');
		expect(mockedMerge).toHaveBeenCalledTimes(1); // s1 only
		expect(report.errors).toEqual([]);
	});

	// WHY: other devices read the manifest to discover stories; dropping excluded
	// entries would orphan their archives and hide them from every other device.
	it('keeps excluded stories in the rewritten manifest', async () => {
		const backend = excludedBackend();

		await syncNow(backend, { excludedStoryIds: ['s2', 's3'] });

		const uploaded = JSON.parse(new TextDecoder().decode(backend.store[MANIFEST_PATH]));
		expect(uploaded.stories.s2.archiveHash).toBe('remote-2');
		expect(uploaded.stories.s3.archiveHash).toBe('remote-3');
		expect(uploaded.stories.s1.archiveHash).not.toBe('stale-1');
	});

	it('reports progress for every processed story', async () => {
		const exportData = { marker: 'stable' };
		const matchingHash = await computeContentHash(JSON.stringify(exportData), []);
		mockedStories.mockResolvedValue([story('s1', 'Story 1')]);
		mockedExportData.mockResolvedValue(exportData as never);
		const backend = fakeBackend({
			[MANIFEST_PATH]: manifestJson({ s1: { name: 'Story 1', archiveHash: matchingHash } }),
		});
		const updates: SyncProgress[] = [];

		await syncNow(backend, { onProgress: (p) => updates.push(p) });

		// 1 pull candidate + 1 push candidate
		expect(updates[0]).toEqual({ total: 2, done: 0, current: '' });
		expect(updates.at(-1)).toEqual({ total: 2, done: 2, current: 'Story 1' });
	});
});
