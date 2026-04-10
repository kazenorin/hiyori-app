import { initDatabase } from '$lib/db/database';
import { runMigrations } from '$lib/db/migrations';
import { loadStories, restoreState } from '$lib/stores/stories.svelte';
import { loadWorldTemplate, loadGenerateWorldFromChatPrompt, loadGenerateWorldFromChatSystemPrompt, loadWorldBuilderSystemPrompt } from '$lib/fs/world-prompts';
import { initLogging, log } from '$lib/logging/logger';

let initialized = false;
let initializing = false;

export async function initializeApp(onStatus?: (status: string) => void): Promise<void> {
	if (initialized || initializing) return;
	initializing = true;

	try {
		await initLogging();
		log.info('init', 'Initializing database...');
		onStatus?.('Initializing database...');
		await initDatabase();

		log.info('init', 'Running migrations...');
		onStatus?.('Running migrations...');
		await runMigrations();

		log.info('init', 'Loading world prompts...');
		onStatus?.('Loading world prompts...');
		await loadWorldTemplate();
		await loadGenerateWorldFromChatPrompt();
		await loadGenerateWorldFromChatSystemPrompt();
		await loadWorldBuilderSystemPrompt();

		log.info('init', 'Loading stories...');
		onStatus?.('Loading stories...');
		await loadStories();

		log.info('init', 'Restoring state...');
		onStatus?.('Restoring state...');
		await restoreState();

		log.info('init', 'Done');
		initialized = true;
	} catch (err) {
		log.error('init', 'Failed', err);
		throw err;
	} finally {
		initializing = false;
	}
}

export function isAppInitialized(): boolean {
	return initialized;
}