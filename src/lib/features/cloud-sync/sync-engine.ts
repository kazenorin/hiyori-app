import type { SyncBackend } from './sync-backend';
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
	action: 'skipped' | 'pushed' | 'pulled-new' | 'merged' | 'up-to-date';
}

export interface SyncReport {
	entries: SyncReportEntry[];
	errors: string[];
}

async function computeLocalStoryHash(storyId: string): Promise<string> {
	const exportData = await buildStoryExportData(storyId);
	const folder = await getStoryFolderInfo(storyId);
	const files: { path: string; hash: string }[] = [];
	if (folder?.folderName && (await fs.exists(folder.folderName).catch(() => false))) {
		for (const filePath of await collectFilesInDir(folder.folderName)) {
			files.push({ path: filePath, hash: await hashBytes(await fs.readBinaryFile(filePath)) });
		}
	}
	return computeContentHash(JSON.stringify(exportData), files);
}

export async function syncNow(backend: SyncBackend): Promise<SyncReport> {
	const report: SyncReport = { entries: [], errors: [] };

	let remote: SyncManifest = emptyManifest();
	try {
		remote = parseManifest(new TextDecoder().decode(await backend.download(MANIFEST_PATH)));
	} catch {
		// No manifest yet — treat remote as empty (first sync from this account).
	}

	const localStories = await getAllStories();
	const localHashes = new Map<string, string>();

	// Pull pass: remote entries that differ from local state.
	for (const [storyId, entry] of Object.entries(remote.stories)) {
		try {
			const localExists = localStories.some((s) => s.id === storyId);
			const localHash = localExists ? await computeLocalStoryHash(storyId) : undefined;
			if (localHash === entry.archiveHash) {
				localHashes.set(storyId, entry.archiveHash);
				report.entries.push({ storyId, storyName: entry.name, action: 'skipped' });
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
		}
	}

	// Push pass: local stories whose hash differs from the (now merged) remote entry.
	const manifest: SyncManifest = { version: 1, stories: {} };
	for (const story of localStories) {
		try {
			const localHash = localHashes.get(story.id) ?? (await computeLocalStoryHash(story.id));
			const remoteHash = remote.stories[story.id]?.archiveHash;
			if (localHash === remoteHash) {
				manifest.stories[story.id] = { name: story.name, archiveHash: localHash, updatedAt: Date.now() };
				report.entries.push({ storyId: story.id, storyName: story.name, action: 'skipped' });
				continue;
			}
			const { data } = await buildStoryArchive(story.id);
			const pushedHash = await computeLocalStoryHash(story.id);
			await backend.upload(`${ARCHIVE_DIR}/${story.id}.hiyori.zip`, data);
			manifest.stories[story.id] = { name: story.name, archiveHash: pushedHash, updatedAt: Date.now() };
			report.entries.push({ storyId: story.id, storyName: story.name, action: 'pushed' });
		} catch (err) {
			report.errors.push(`Push failed for "${story.name}": ${err}`);
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
