import { getSettings } from '$lib/stores/settings.svelte';
import { createBackendFromSettings } from './backend-factory';
import { syncNow, removeStoryFromCloud, type SyncReport } from './sync-engine';
import { log } from '$lib/logging/logger';

export type CloudSyncStatus = 'unconfigured' | 'idle' | 'syncing' | 'testing';

let status = $state<CloudSyncStatus>('unconfigured');
let lastReport = $state<SyncReport | null>(null);
let lastSyncedAt = $state<number | null>(null);
let errorMessage = $state<string | null>(null);

export function getCloudSyncStatus(): CloudSyncStatus {
	return status;
}
export function getLastSyncReport(): SyncReport | null {
	return lastReport;
}
export function getLastSyncedAt(): number | null {
	return lastSyncedAt;
}
export function getCloudSyncError(): string | null {
	return errorMessage;
}

export function refreshCloudSyncStatus(): void {
	status = createBackendFromSettings(getSettings()) ? 'idle' : 'unconfigured';
}

export async function testCloudSyncConnection(): Promise<void> {
	const backend = createBackendFromSettings(getSettings());
	if (!backend) return;
	status = 'testing';
	errorMessage = null;
	try {
		await backend.testConnection();
	} catch (err) {
		errorMessage = String(err instanceof Error ? err.message : err);
		await log.warn('cloud-sync', `Connection test failed: ${errorMessage}`);
	} finally {
		refreshCloudSyncStatus();
	}
}

export async function runCloudSync(): Promise<void> {
	const backend = createBackendFromSettings(getSettings());
	if (!backend || status === 'syncing') return;
	status = 'syncing';
	errorMessage = null;
	try {
		lastReport = await syncNow(backend);
		lastSyncedAt = Date.now();
		if (lastReport.errors.length > 0) {
			errorMessage = lastReport.errors.join('\n');
			await log.warn('cloud-sync', `Sync completed with errors: ${errorMessage}`);
		}
	} catch (err) {
		errorMessage = String(err instanceof Error ? err.message : err);
		await log.error('cloud-sync', `Sync failed: ${errorMessage}`);
	} finally {
		refreshCloudSyncStatus();
	}
}

export async function removeStoryFromCloudById(storyId: string): Promise<void> {
	const backend = createBackendFromSettings(getSettings());
	if (!backend) return;
	await removeStoryFromCloud(backend, storyId);
}
