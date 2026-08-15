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

import type { SyncBackend } from '$lib/features/cloud-sync/sync-backend';
import { syncNow, MANIFEST_PATH } from '$lib/features/cloud-sync/sync-engine';
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
			if (!data) throw new Error(`404: ${path}`);
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
});
