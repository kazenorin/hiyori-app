import { v4 as uuidv4 } from 'uuid';
import { omitBy } from 'lodash-es';
import { getDatabase } from '$lib/db/database';
import { fs } from '$lib/fs/file-system';
import { detectDefaultLocale, setLocale } from '$lib/i18n';
import type { CallSettings } from 'ai';
import type { SharedV3ProviderOptions } from '@ai-sdk/provider';

export type Provider = 'openai' | 'openai-compatible' | 'ollama';
export type ApiType = 'chat-completions' | 'responses';
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type ThemeMode = 'system' | 'light' | 'dark';

export const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
	error: 1,
	warn: 2,
	info: 3,
	debug: 4,
};

export interface ProviderConfig {
	id: string;
	name: string;
	provider: Provider;
	apiType: ApiType;
	baseURL: string;
	model: string;
	apiKey?: string;
	corsBypassEnabled: boolean;
	wispProxyUrl: string;
	callSettings?: CallSettings;
}

export function getProviderOptions(config: ProviderConfig): SharedV3ProviderOptions {
	if (config.provider === 'openai') {
		return {
			openai: {
				reasoningEffort: 'medium',
				reasoningSummary: 'detailed',
			},
		};
	}
	return {};
}

export interface Settings {
	providers: ProviderConfig[];
	roleAssignments: Record<string, string>;
	locale: string;
	themeMode: ThemeMode;
	colorTheme: string;
	logLevel: LogLevel;
	fontSize: number;
	memoryEnabled: boolean;
	memoryProviderRole: string;
	embeddingProviderRole: string;
	plotPlannerProviderRole: string;
	plotPlannerEnabled: boolean;
	writerProviderRole: string;
	reviewerProviderRole: string;
	reviewerEnabled: boolean;
	reviewerMode: 'detailed' | 'quick';
	editorProviderRole: string;
	gameMasterProviderRole: string;
	summarizerProviderRole: string;
	minorTaskAgentProviderRole: string;
	importantPhraseHighlighting: boolean;
	targetWordCount: number;
	directorModeEnabled: boolean;
	characterProfileCompressorInterval: number;
	characterProfileImportanceThreshold: number;
	characterProfileMaxIncluded: number;
	ignoreCharacterCardsInChat: boolean;
	phaseAdvancementThreshold: number;
	defaultPlotMode: 'guidance' | 'phaseEvent';
	reevaluationFrequency: number;
	ttsEnabled: boolean;
	ttsVoice: string;
	ttsSpeed: number;
}

const STORAGE_KEY = 'hiyori-settings';

const defaults: Settings = {
	providers: [],
	roleAssignments: {},
	locale: detectDefaultLocale(),
	themeMode: 'system',
	colorTheme: 'hiyori',
	logLevel: 'info',
	fontSize: 1.0,
	memoryEnabled: false,
	memoryProviderRole: 'main',
	embeddingProviderRole: 'main',
	plotPlannerProviderRole: 'main',
	plotPlannerEnabled: true,
	writerProviderRole: 'main',
	reviewerProviderRole: 'main',
	reviewerEnabled: true,
	reviewerMode: 'detailed',
	editorProviderRole: 'main',
	gameMasterProviderRole: 'main',
	summarizerProviderRole: 'main',
	minorTaskAgentProviderRole: 'main',
	importantPhraseHighlighting: false,
	targetWordCount: 400,
	directorModeEnabled: false,
	characterProfileCompressorInterval: 5, // scenes between compressor runs; 0 = disabled
	characterProfileImportanceThreshold: 2, // 1=Protagonist, 2=Main, 3=Supporting, 4=Minor
	characterProfileMaxIncluded: 5, // hard cap on number of full-profile inlines
	ignoreCharacterCardsInChat: false,
	phaseAdvancementThreshold: 5,
	defaultPlotMode: 'phaseEvent',
	reevaluationFrequency: 10,
	ttsEnabled: false,
	ttsVoice: 'af_heart',
	ttsSpeed: 1,
};

/**
 * Apply font size preference by setting the --text-scaling CSS variable.
 */
export function applyFontSizePreference(fontSize: number): void {
	if (typeof document !== 'undefined') {
		document.documentElement.style.setProperty('--text-scaling', String(fontSize));
	}
}

export function applyTheme(mode: ThemeMode, colorTheme: string): void {
	if (typeof document === 'undefined') return;
	const html = document.documentElement;
	html.setAttribute('data-theme', colorTheme);
	html.classList.toggle('dark', mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches));
}

function loadSettings(): Settings {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) {
			const raw = JSON.parse(stored);
			const merged = { ...defaults, ...raw };
			if (merged.providers) {
				merged.providers = merged.providers.map((p: Record<string, unknown>) => ({
					corsBypassEnabled: false,
					wispProxyUrl: 'ws://localhost:6001',
					...p,
				}));
			}
			return merged;
		}
	} catch {
		// Invalid JSON or localStorage unavailable — use defaults
	}
	return { ...defaults };
}

function persist(): void {
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
	}
}

// eslint-disable-next-line prefer-const -- $state requires let
export let settings = $state<Settings>(loadSettings());

/** Apply initial font size preference when store is initialized */
applyFontSizePreference(settings.fontSize);
applyTheme(settings.themeMode, settings.colorTheme);

export function getSettings(): Settings {
	return settings;
}

// --- Provider Config CRUD ---

export function getProviderConfig(id: string): ProviderConfig | undefined {
	return settings.providers.find((p) => p.id === id);
}

export function getMainProviderConfig(): ProviderConfig | undefined {
	const id = settings.roleAssignments['main'];
	if (!id) return undefined;
	return getProviderConfig(id);
}

export function getMemoryProviderConfig(): ProviderConfig | undefined {
	const role = settings.memoryProviderRole || 'main';
	// If it's a named role (like "main"), resolve through roleAssignments
	const id = settings.roleAssignments[role];
	const config = id ? getProviderConfig(id) : getProviderConfig(role);
	if (!config?.model) return undefined;
	return config;
}

/** Resolved memory provider config type (non-nullable after successful resolution) */
export type MemoryProviderConfig = NonNullable<ReturnType<typeof getMemoryProviderConfig>>;

export function getEmbeddingProviderConfig(): ProviderConfig | undefined {
	const role = settings.embeddingProviderRole || 'main';
	const id = settings.roleAssignments[role];
	const config = id ? getProviderConfig(id) : getProviderConfig(role);
	if (!config?.model) return undefined;
	return config;
}

export type EmbeddingProviderConfig = NonNullable<ReturnType<typeof getEmbeddingProviderConfig>>;

export function getReviewerProviderConfig(): ProviderConfig | undefined {
	const role = settings.reviewerProviderRole || 'main';
	const id = settings.roleAssignments[role];
	const config = id ? getProviderConfig(id) : getProviderConfig(role);
	if (!config?.model) return undefined;
	return config;
}

export type ReviewerProviderConfig = NonNullable<ReturnType<typeof getReviewerProviderConfig>>;

export function getPlotPlannerProviderConfig(): ProviderConfig | undefined {
	const role = settings.plotPlannerProviderRole || 'main';
	const id = settings.roleAssignments[role];
	const config = id ? getProviderConfig(id) : getProviderConfig(role);
	if (!config?.model) return undefined;
	return config;
}

export type PlotPlannerProviderConfig = NonNullable<ReturnType<typeof getPlotPlannerProviderConfig>>;

export function getWriterProviderConfig(): ProviderConfig | undefined {
	const role = settings.writerProviderRole || 'main';
	const id = settings.roleAssignments[role];
	const config = id ? getProviderConfig(id) : getProviderConfig(role);
	if (!config?.model) return undefined;
	return config;
}

export type WriterProviderConfig = NonNullable<ReturnType<typeof getWriterProviderConfig>>;

export function getEditorProviderConfig(): ProviderConfig | undefined {
	const role = settings.editorProviderRole || 'main';
	const id = settings.roleAssignments[role];
	const config = id ? getProviderConfig(id) : getProviderConfig(role);
	if (!config?.model) return undefined;
	return config;
}

export type EditorProviderConfig = NonNullable<ReturnType<typeof getEditorProviderConfig>>;

export function getGameMasterProviderConfig(): ProviderConfig | undefined {
	const role = settings.gameMasterProviderRole || 'main';
	const id = settings.roleAssignments[role];
	const config = id ? getProviderConfig(id) : getProviderConfig(role);
	if (!config?.model) return undefined;
	return config;
}

export type GameMasterProviderConfig = NonNullable<ReturnType<typeof getGameMasterProviderConfig>>;

export function getSummarizerProviderConfig(): ProviderConfig | undefined {
	const role = settings.summarizerProviderRole || 'main';
	const id = settings.roleAssignments[role];
	const config = id ? getProviderConfig(id) : getProviderConfig(role);
	if (!config?.model) return undefined;
	return config;
}

export type SummarizerProviderConfig = NonNullable<ReturnType<typeof getSummarizerProviderConfig>>;

export function getMinorTaskAgentProviderConfig(): ProviderConfig | undefined {
	const role = settings.minorTaskAgentProviderRole || 'main';
	const id = settings.roleAssignments[role];
	const config = id ? getProviderConfig(id) : getProviderConfig(role);
	if (!config?.model) return undefined;
	return config;
}

export type MinorTaskAgentProviderConfig = NonNullable<ReturnType<typeof getMinorTaskAgentProviderConfig>>;

export function isPhraseHighlightingEnabled(): boolean {
	return settings.importantPhraseHighlighting && !!getMinorTaskAgentProviderConfig();
}

export function isTTSEnabled(): boolean {
	return settings.ttsEnabled;
}

export function getTTSVoice(): string {
	return settings.ttsVoice;
}

export function getTTSSpeed(): number {
	return settings.ttsSpeed;
}

export function isMemoryCapable(): boolean {
	try {
		return getDatabase().isSqliteVecAvailable();
	} catch {
		return false;
	}
}

export function isMemoryAvailable(): boolean {
	return settings.memoryEnabled && isMemoryCapable();
}

export function isPlotPlannerEnabled(): boolean {
	return settings.plotPlannerEnabled && !!getPlotPlannerProviderConfig();
}

export function isReviewerEnabled(): boolean {
	return settings.reviewerEnabled;
}

export function isDirectorModeEnabled(): boolean {
	return settings.directorModeEnabled;
}

export function isQuickReview(): boolean {
	return settings.reviewerMode === 'quick';
}

export function getReevaluationFrequency(): number {
	return settings.reevaluationFrequency;
}

export function getDefaultPlotMode(): 'guidance' | 'phaseEvent' {
	return settings.defaultPlotMode;
}

export function getProviderConfigForRole(role: string): ProviderConfig | undefined {
	const id = settings.roleAssignments[role];
	if (!id) return undefined;
	return getProviderConfig(id);
}

export function addProviderConfig(partial: Omit<ProviderConfig, 'id'>): ProviderConfig {
	const config: ProviderConfig = { ...partial, id: uuidv4() };
	settings.providers = [...settings.providers, config];
	persist();
	return config;
}

export function updateProviderConfig(id: string, partial: Partial<Omit<ProviderConfig, 'id'>>): void {
	settings.providers = settings.providers.map((p) => (p.id === id ? { ...p, ...partial } : p));
	persist();
}

export function deleteProviderConfig(id: string): void {
	settings.providers = settings.providers.filter((p) => p.id !== id);
	// Clean up any role assignments pointing to the deleted config
	settings.roleAssignments = omitBy(settings.roleAssignments, (configId) => configId === id);
	persist();
}

export function assignRole(role: string, providerConfigId: string): void {
	settings.roleAssignments[role] = providerConfigId;
	persist();
}

type UpdatableSettings = Omit<Settings, 'providers' | 'roleAssignments'>;

// --- Global Settings ---

export async function updateSettings(partial: Partial<UpdatableSettings>): Promise<void> {
	const prevFontSize = settings.fontSize;
	const prevLogLevel = settings.logLevel;
	const prevLocale = settings.locale;

	for (const [key, value] of Object.entries(partial)) {
		if (value !== undefined) {
			(settings as unknown as Record<string, unknown>)[key] = value;
		}
	}
	persist();

	// Apply font size preference when fontSize changes
	if (partial.fontSize !== undefined && partial.fontSize !== prevFontSize) {
		applyFontSizePreference(settings.fontSize);
	}

	// Apply theme when themeMode or colorTheme changes
	if (partial.themeMode !== undefined || partial.colorTheme !== undefined) {
		applyTheme(settings.themeMode, settings.colorTheme);
	}

	// Sync log level to Rust backend
	if (partial.logLevel !== undefined && partial.logLevel !== prevLogLevel) {
		try {
			const { invoke } = await import('@tauri-apps/api/core');
			await invoke('set_log_level', { level: partial.logLevel });
		} catch {
			// Rust backend may not be available in all environments
		}
	}

	// Sync locale to i18n system and locale strings
	if (partial.locale !== undefined && partial.locale !== prevLocale) {
		try {
			await setLocale(partial.locale);
		} catch (err) {
			console.error('Failed to sync locale to i18n:', err);
		}
		// Only reload locale strings if no story is active
		// (stories.svelte.ts handles locale string loading on story select)
		try {
			const { getActiveStoryId } = await import('$lib/stores/stories.svelte');
			if (!getActiveStoryId()) {
				const { setActiveLocale } = await import('$lib/fs/prompt-loader');
				setActiveLocale(partial.locale);
				const { loadLocaleStrings } = await import('$lib/localization');
				await loadLocaleStrings(partial.locale);
			}
		} catch (err) {
			console.error('Failed to sync locale strings:', err);
		}
	}
}

export async function resetConfiguration(): Promise<void> {
	try {
		await fs.remove('config');
	} catch {
		// config/ may not exist — that's fine
	}
	localStorage.removeItem(STORAGE_KEY);
	Object.assign(settings, { ...defaults });
	persist();
}
