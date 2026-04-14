import { initDatabase } from '$lib/db/database';
import { runMigrations } from '$lib/db/migrations';
import { loadStories, restoreState } from '$lib/stores/stories.svelte';
import { loadWorldTemplate, loadGenerateWorldFromChatPrompt, loadGenerateWorldFromChatSystemPrompt, loadWorldBuilderSystemPrompt, ensureAllBaseConfigs } from '$lib/fs/prompts';
import { initLogging, log } from '$lib/logging/logger';
import { getSettings } from '$lib/stores/settings.svelte';

let initialized = false;
let initializing = false;

export async function initializeApp(onStatus?: (status: string) => void): Promise<void> {
	if (initialized || initializing) return;
	initializing = true;

	try {
		await initLogging();
		const settings = getSettings();
		try {
			const { invoke } = await import('@tauri-apps/api/core');
			await invoke('set_log_level', { level: settings.logLevel });
		} catch {
			// Rust backend unavailable
		}
		await log.info('init', 'Initializing database...');
		onStatus?.('Initializing database...');
		await initDatabase();

		await log.info('init', 'Running migrations...');
		onStatus?.('Running migrations...');
		await runMigrations();

		await log.info('init', 'Ensuring base configs...');
		onStatus?.('Ensuring base configs...');
		await ensureAllBaseConfigs();

		await log.info('init', 'Loading world prompts...');
		onStatus?.('Loading world prompts...');
		await loadWorldTemplate();
		await loadGenerateWorldFromChatPrompt();
		await loadGenerateWorldFromChatSystemPrompt();
		await loadWorldBuilderSystemPrompt();

		await log.info('init', 'Loading stories...');
		onStatus?.('Loading stories...');
		await loadStories();

		await log.info('init', 'Restoring state...');
		onStatus?.('Restoring state...');
		await restoreState();

		await log.info('init', 'Done');
		initialized = true;
	} catch (err) {
		await log.error('init', 'Failed', err);
		throw err;
	} finally {
		initializing = false;
	}
}

export function isAppInitialized(): boolean {
	return initialized;
}