import { initDatabase, getDatabase } from '$lib/db/database';
import { runMigrations } from '$lib/db/migrations';
import { initMemoryDatabase, getMemoryDatabase } from '$lib/db/memory-database';
import { runMemoryMigrations } from '$lib/db/memory-migrations';
import { loadStories, restoreState } from '$lib/stores/stories.svelte';
import {
	worldTemplateLoader,
	worldBuilderSystemPromptLoader,
	memoryExtractionSystemPromptLoader,
	memoryExtractionPromptLoader,
} from '$lib/fs/prompts';
import { ensureAllBaseConfigs, setActiveLocale } from '$lib/fs/prompt-loader';
import { initLogging, log } from '$lib/logging/logger';
import { getSettings } from '$lib/stores/settings.svelte';
import { loadLocale } from '$lib/i18n';
import { loadLocaleStrings } from '$lib/localization';
import { ensureAllLocaleStringConfigs } from '$lib/fs/locale-string-loader';
import { initFileSystem } from '$lib/fs/file-system';
import { initHttpClient } from '$lib/http/fetch';

let initialized = false;
let initializing = false;

export async function initializeApp(onStatus?: (status: string) => void): Promise<void> {
	if (initialized || initializing) return;
	initializing = true;

	try {
		await initFileSystem();
		await initLogging();
		initHttpClient();
		const settings = getSettings();
		await loadLocale(settings.locale || 'en');
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

		await log.info('init', 'Initializing memory database...');
		onStatus?.('Initializing memory database...');
		await initMemoryDatabase();
		await runMemoryMigrations();

		if (typeof window !== 'undefined') {
			window.addEventListener('beforeunload', () => {
				getDatabase()
					.flush()
					.catch(() => {});
				getMemoryDatabase()
					.flush()
					.catch(() => {});
			});
		}

		await log.info('init', 'Ensuring base configs...');
		onStatus?.('Ensuring base configs...');
		await ensureAllBaseConfigs();

		await log.info('init', 'Ensuring locale string configs...');
		await ensureAllLocaleStringConfigs();

		await log.info('init', 'Loading locale strings...');
		await loadLocaleStrings(settings.locale || 'en');

		await log.info('init', 'Loading world prompts...');
		onStatus?.('Loading world prompts...');
		setActiveLocale(settings.locale || 'en');
		await worldTemplateLoader.loadDefault();
		await worldBuilderSystemPromptLoader.loadDefault();

		await log.info('init', 'Loading memory prompts...');
		await memoryExtractionSystemPromptLoader.loadDefault();
		await memoryExtractionPromptLoader.loadDefault();

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
