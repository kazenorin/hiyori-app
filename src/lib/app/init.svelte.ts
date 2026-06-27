import { initDatabase, getDatabase } from '$lib/db/database';
import { runMigrations } from '$lib/db/migrations';
import { initMemoryDatabase, getMemoryDatabase } from '$lib/db/memory-database';
import { runMemoryMigrations } from '$lib/db/memory-migrations';
import { loadStories, restoreState } from '$lib/stores/stories.svelte';
import {
	highFantasyTemplateLoader,
	modernSliceOfLifeTemplateLoader,
	sciFiTemplateLoader,
	urbanFantasyTemplateLoader,
	worldPreTemplateDiscoveryLoader,
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
import { checkIsTauri, detectPlatform } from '$lib/runtime';

let initialized = false;
let initializing = false;

export async function initializeApp(onStatus?: (status: string) => void): Promise<void> {
	if (initialized || initializing) return;
	initializing = true;

	try {
		await initLogging();
		await log.info('init', 'Initialized logging...');

		await initFileSystem();
		await log.info('init', 'Initialized File System...');

		const settings = getSettings();
		await loadLocale(settings.locale || 'en');
		try {
			if (await checkIsTauri()) {
				const { invoke } = await import('@tauri-apps/api/core');
				await invoke('set_log_level', { level: settings.logLevel });
			}
		} catch {
			// Rust backend unavailable
		}

		// Resolve and cache the current platform (web / desktop / android).
		// Must run after checkIsTauri() so the Tauri cache is populated.
		await detectPlatform();

		await initHttpClient();
		await log.info('init', 'Initialized HTTP Client...');
		await log.info('init', 'Initializing database...');

		onStatus?.('Initializing database...');
		const db = await initDatabase();

		await log.info('init', 'Running migrations...');
		onStatus?.('Running migrations...');
		await runMigrations();

		await log.info('init', 'Initializing memory database...');
		onStatus?.('Initializing memory database...');
		if (db.isSqliteVecAvailable()) {
			await initMemoryDatabase();
			await runMemoryMigrations();
		} else {
			await log.info('init', 'sqlite-vec unavailable — memory system disabled');
		}

		if (typeof window !== 'undefined') {
			window.addEventListener('beforeunload', () => {
				getDatabase()
					.flush()
					.catch(() => {});
				if (db.isSqliteVecAvailable()) {
					getMemoryDatabase()
						.flush()
						.catch(() => {});
				}
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
		await highFantasyTemplateLoader.loadDefault();
		await modernSliceOfLifeTemplateLoader.loadDefault();
		await sciFiTemplateLoader.loadDefault();
		await urbanFantasyTemplateLoader.loadDefault();
		await worldPreTemplateDiscoveryLoader.loadDefault();
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
