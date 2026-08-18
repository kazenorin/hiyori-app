import { NotFoundError, type SyncBackend } from './sync-backend';
import { emptyManifest, parseManifest, computeContentHash, hashBytes, type SyncManifest } from './sync-manifest';
import { buildStoryArchive, buildStoryExportData } from '$lib/features/story-export-load/story-exporter';
import { getAllStories } from '$lib/db/stories';
import { mergeIncomingStory } from './sync-merge';
import { collectFilesInDir } from '$lib/fs/file-tree';
import { fs } from '$lib/fs/file-system';
import { getStoryFolderInfo } from '$lib/db/story-folders';

export const MANIFEST_PATH = 'hiyori-manifest.json';
const ARCHIVE_DIR = 'stories';

export interface SyncReportEntry {
	storyId: string;
	storyName: string;
	action: 'skipped' | 'pushed' | 'pulled-new' | 'merged' | 'up-to-date' | 'removed';
}

export interface SyncReport {
	entries: SyncReportEntry[];
	errors: string[];
}

export interface SyncProgress {
	total: number;
	done: number;
	current: string;
}

export interface SyncOptions {
	/** Story ids excluded from both pull and push passes */
	excludedStoryIds?: string[];
	onProgress?: (progress: SyncProgress) => void;
}

async function computeLocalStoryHash(storyId: string): Promise<string> {
	const exportData = await buildStoryExportData(storyId);
	// storyFolder.createdAt falls back to Date.now() when no folder row exists,
	// which would make the hash differ on every call and across devices.
	const { storyFolder: _storyFolder, ...hashable } = exportData;
	const folder = await getStoryFolderInfo(storyId);
	const files: { path: string; hash: string }[] = [];
	if (folder?.folderName && (await fs.exists(folder.folderName).catch(() => false))) {
		for (const filePath of await collectFilesInDir(folder.folderName)) {
			files.push({ path: filePath, hash: await hashBytes(await fs.readBinaryFile(filePath)) });
		}
	}
	return computeContentHash(JSON.stringify(hashable), files);
}

export async function syncNow(backend: SyncBackend, options: SyncOptions = {}): Promise<SyncReport> {
	const report: SyncReport = { entries: [], errors: [] };
	const excluded = new Set(options.excludedStoryIds ?? []);

	let remote: SyncManifest = emptyManifest();
	try {
		remote = parseManifest(new TextDecoder().decode(await backend.download(MANIFEST_PATH)));
	} catch (err) {
		if (!(err instanceof NotFoundError)) {
			// A transient network failure or corrupt manifest must not be treated
			// as "remote is empty" — the push pass would overwrite newer remote
			// archives with stale local ones.
			report.errors.push(`Sync aborted: could not read cloud manifest: ${err}`);
			return report;
		}
		// No manifest yet — first sync from this account.
	}

	const localStories = await getAllStories();
	const localHashes = new Map<string, string>();

	const pullCandidates = Object.entries(remote.stories).filter(([storyId]) => !excluded.has(storyId));
	const pushCandidates = localStories.filter((story) => !excluded.has(story.id));
	const removalCandidates = Object.entries(remote.stories).filter(([storyId]) => excluded.has(storyId));
	const progress: SyncProgress = {
		total: pullCandidates.length + pushCandidates.length + removalCandidates.length,
		done: 0,
		current: '',
	};
	options.onProgress?.({ ...progress });

	// Pull pass: remote entries that differ from local state.
	for (const [storyId, entry] of pullCandidates) {
		progress.current = entry.name;
		options.onProgress?.({ ...progress });
		try {
			const localExists = localStories.some((s) => s.id === storyId);
			const localHash = localExists ? await computeLocalStoryHash(storyId) : undefined;
			if (localHash === entry.archiveHash) {
				localHashes.set(storyId, entry.archiveHash);
				// No report entry here: the push pass reports the story once as
				// 'skipped' — duplicate entries would crash the keyed report list.
				continue;
			}
			const archive = await backend.download(`${ARCHIVE_DIR}/${storyId}.hiyori.zip`);
			const result = await mergeIncomingStory(archive);
			localHashes.set(storyId, await computeLocalStoryHash(storyId));
			report.entries.push({
				storyId,
				storyName: entry.name,
				action: result === 'new-story' ? 'pulled-new' : result === 'merged' ? 'merged' : 'skipped',
			});
		} catch (err) {
			report.errors.push(`Pull failed for "${entry.name}": ${err}`);
		} finally {
			progress.done++;
			options.onProgress?.({ ...progress });
		}
	}

	// Push pass: local stories whose hash differs from the (now merged) remote entry.
	const manifest: SyncManifest = { version: 1, stories: {} };
	for (const story of pushCandidates) {
		progress.current = story.name;
		options.onProgress?.({ ...progress });
		try {
			const localHash = localHashes.get(story.id) ?? (await computeLocalStoryHash(story.id));
			const remoteHash = remote.stories[story.id]?.archiveHash;
			if (localHash === remoteHash) {
				manifest.stories[story.id] = { name: story.name, archiveHash: localHash, updatedAt: Date.now() };
				// Stories merged/pulled earlier this run already have a report entry;
				// keep entries unique per story (the report list is keyed by story+action).
				if (!report.entries.some((e) => e.storyId === story.id)) {
					report.entries.push({ storyId: story.id, storyName: story.name, action: 'skipped' });
				}
				continue;
			}
			const { data } = await buildStoryArchive(story.id);
			const pushedHash = await computeLocalStoryHash(story.id);
			await backend.upload(`${ARCHIVE_DIR}/${story.id}.hiyori.zip`, data);
			manifest.stories[story.id] = { name: story.name, archiveHash: pushedHash, updatedAt: Date.now() };
			report.entries.push({ storyId: story.id, storyName: story.name, action: 'pushed' });
		} catch (err) {
			report.errors.push(`Push failed for "${story.name}": ${err}`);
		} finally {
			progress.done++;
			options.onProgress?.({ ...progress });
		}
	}

	// Removal pass: excluding a story from sync also removes it from cloud
	// storage. Backend deletes tolerate 404, so already-removed archives are fine.
	const removedIds = new Set<string>();
	for (const [storyId, entry] of removalCandidates) {
		progress.current = entry.name;
		options.onProgress?.({ ...progress });
		try {
			await backend.delete(`${ARCHIVE_DIR}/${storyId}.hiyori.zip`);
			removedIds.add(storyId);
			report.entries.push({ storyId, storyName: entry.name, action: 'removed' });
		} catch (err) {
			report.errors.push(`Removal failed for "${entry.name}": ${err}`);
		} finally {
			progress.done++;
			options.onProgress?.({ ...progress });
		}
	}

	// Carry over entries whose removal failed so the archive stays discoverable
	// and the removal is retried on the next sync.
	for (const [storyId, entry] of Object.entries(remote.stories)) {
		if (excluded.has(storyId) && !removedIds.has(storyId) && !manifest.stories[storyId]) {
			manifest.stories[storyId] = entry;
		}
	}

	// Manifest last: an interrupted sync re-detects dirty stories on next run.
	await backend.upload(MANIFEST_PATH, new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
	return report;
}

export async function removeStoryFromCloud(backend: SyncBackend, storyId: string): Promise<void> {
	await backend.delete(`${ARCHIVE_DIR}/${storyId}.hiyori.zip`);
	try {
		const manifest = parseManifest(new TextDecoder().decode(await backend.download(MANIFEST_PATH)));
		delete manifest.stories[storyId];
		await backend.upload(MANIFEST_PATH, new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
	} catch {
		// No manifest — nothing else to clean up.
	}
}
