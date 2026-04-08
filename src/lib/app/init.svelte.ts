import { initDatabase } from '$lib/db/database';
import { runMigrations } from '$lib/db/migrations';
import { loadStories, restoreState } from '$lib/stores/stories.svelte';

let initialized = false;
let initializing = false;

export async function initializeApp(onStatus?: (status: string) => void): Promise<void> {
	if (initialized || initializing) return;
	initializing = true;

	try {
		onStatus?.('Initializing database...');
		console.log('[init] Initializing database...');
		await initDatabase();

		onStatus?.('Running migrations...');
		console.log('[init] Running migrations...');
		await runMigrations();

		onStatus?.('Loading stories...');
		console.log('[init] Loading stories...');
		await loadStories();

		onStatus?.('Restoring state...');
		console.log('[init] Restoring state...');
		await restoreState();

		console.log('[init] Done');
		initialized = true;
	} catch (err) {
		console.error('[init] Failed:', err);
		throw err;
	} finally {
		initializing = false;
	}
}

export function isAppInitialized(): boolean {
	return initialized;
}