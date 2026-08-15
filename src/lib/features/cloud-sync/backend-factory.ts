import type { Settings } from '$lib/stores/settings.svelte';
import type { SyncBackend } from './sync-backend';
import { S3Backend } from './s3-backend';
import { WebDavBackend } from './webdav-backend';

/** Returns undefined when cloud sync is disabled or the selected backend lacks credentials. */
export function createBackendFromSettings(settings: Settings): SyncBackend | undefined {
	const sync = settings.cloudSync;
	if (!sync?.enabled) return undefined;

	if (sync.backend === 's3') {
		const c = sync.s3;
		if (!c?.endpoint || !c?.bucket || !c?.accessKeyId || !c?.secretAccessKey) return undefined;
		return new S3Backend(c);
	}

	const c = sync.webdav;
	if (!c?.url || !c?.username || !c?.password) return undefined;
	return new WebDavBackend(c);
}
