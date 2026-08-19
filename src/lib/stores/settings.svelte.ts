import { v4 as uuidv4 } from 'uuid';
import { isEqual, omitBy } from 'lodash-es';
import { getDatabase } from '$lib/db/database';
import { DEFAULT_NAME_QUOTAS, type NameQuotaConfig } from '$lib/features/name-suggestion/quota';
import { fs } from '$lib/fs/file-system';
import { detectDefaultLocale, setLocale, type Locale } from '$lib/i18n';
import { setLogLevel, type LogLevel } from '$lib/logging/logger';
import type { LanguageModelCallOptions } from 'ai';
import type { VoiceId } from '$lib/kokoro/kokoro-hiyori';

export type { LogLevel };

export type Provider = 'openai' | 'openai-compatible' | 'ollama';
export type ApiType = 'chat-completions' | 'responses';
export type ThemeMode = 'system' | 'light' | 'dark';
export type CharacterNameSuggestionMode = 'ai' | 'analytic';

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
	callSettings?: LanguageModelCallOptions;
}

export interface Settings {
	providers: ProviderConfig[];
	roleAssignments: Record<string, string>;
	/** Per-role Advanced Settings overrides; presence of an entry means the role overrides its provider's callSettings */
	roleCallSettings: Record<string, LanguageModelCallOptions>;
	locale: string;
	themeMode: ThemeMode;
	colorTheme: string;
	logLevel: LogLevel;
	fontSize: number;
	memoryEnabled: boolean;
	inventoryEnabled: boolean;
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
	phaseAdvancementThreshold: number;
	playerDivergenceThreshold: number;
	defaultPlotMode: 'guidance' | 'phaseEvent';
	reevaluationFrequency: number;
	ttsVoices: Record<Locale, VoiceId | null>;
	ttsSpeed: number;
	characterNameSuggestionMode: CharacterNameSuggestionMode;
	nameSuggestionQuotas: NameQuotaConfig;
	cloudSync?: {
		enabled: boolean;
		backend: 's3' | 'webdav';
		excludedStories?: { id: string; name: string }[];
		corsBypassEnabled?: boolean;
		wispProxyUrl?: string;
		s3?: {
			endpoint: string;
			region: string;
			bucket: string;
			prefix?: string;
			accessKeyId: string;
			secretAccessKey: string;
		};
		webdav?: { url: string; username: string; password: string };
	};
}

const STORAGE_KEY = 'hiyori-settings';

// Factory (not a module-level const) so detectDefaultLocale() runs lazily,
// avoiding a circular-init crash when i18n -> logger -> settings loads first.
function createDefaults(): Settings {
	return {
		providers: [],
		roleAssignments: {},
		roleCallSettings: {},
		locale: detectDefaultLocale(),
		themeMode: 'system',
		colorTheme: 'hiyori',
		logLevel: 'info',
		fontSize: 1.0,
		memoryEnabled: false,
		inventoryEnabled: false,
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
		phaseAdvancementThreshold: 5,
		playerDivergenceThreshold: 8,
		defaultPlotMode: 'phaseEvent',
		reevaluationFrequency: 10,
		ttsVoices: { en: null, 'zh-Hant-HK': null },
		ttsSpeed: 1,
		characterNameSuggestionMode: 'analytic',
		nameSuggestionQuotas: DEFAULT_NAME_QUOTAS,
	};
}

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
			const merged = { ...createDefaults(), ...raw };
			if (merged.providers) {
				merged.providers = merged.providers.map((p: Record<string, unknown>) => ({
					corsBypassEnabled: false,
					wispProxyUrl: 'ws://localhost:6001',
					...p,
				}));
			}
			if (merged.cloudSync) {
				merged.cloudSync = {
					corsBypassEnabled: false,
					wispProxyUrl: 'ws://localhost:6001',
					...merged.cloudSync,
				};
			}
			return merged;
		}
	} catch {
		// Invalid JSON or localStorage unavailable — use defaults
	}
	return { ...createDefaults() };
}

function persist(): void {
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
	}
}

// eslint-disable-next-line prefer-const -- $state requires let
export let settings = $state<Settings>(loadSettings());

/** Apply initial preferences when store is initialized */
applyFontSizePreference(settings.fontSize);
applyTheme(settings.themeMode, settings.colorTheme);
setLogLevel(settings.logLevel);

export function getSettings(): Settings {
	return settings;
}

// --- Provider Config CRUD ---

export function getProviderConfig(id: string): ProviderConfig | undefined {
	return settings.providers.find((p) => p.id === id);
}

/** Returns the config with the role's Advanced Settings override applied, if any */
function applyRoleCallSettings(config: ProviderConfig, roleKey: string): ProviderConfig {
	const override = settings.roleCallSettings[roleKey];
	return override !== undefined ? { ...config, callSettings: override } : config;
}

export function getMainProviderConfig(): ProviderConfig | undefined {
	const id = settings.roleAssignments['main'];
	if (!id) return undefined;
	const config = getProviderConfig(id);
	if (!config) return undefined;
	return applyRoleCallSettings(config, 'main');
}

/**
 * Resolves a pipeline role's provider config.
 * Advanced Settings precedence: the role's own override > the selected provider role's
 * override (e.g. 'main') > the provider config's own callSettings.
 */
function resolvePipelineRoleProviderConfig(roleKey: string, providerRole: string): ProviderConfig | undefined {
	const role = providerRole || 'main';
	const id = settings.roleAssignments[role];
	const config = id ? getProviderConfig(id) : getProviderConfig(role);
	if (!config?.model) return undefined;
	const override = settings.roleCallSettings[roleKey] ?? settings.roleCallSettings[role];
	return override !== undefined ? { ...config, callSettings: override } : config;
}

export function getMemoryProviderConfig(): ProviderConfig | undefined {
	return resolvePipelineRoleProviderConfig('memory', settings.memoryProviderRole);
}

/** Resolved memory provider config type (non-nullable after successful resolution) */
export type MemoryProviderConfig = NonNullable<ReturnType<typeof getMemoryProviderConfig>>;

export function getEmbeddingProviderConfig(): ProviderConfig | undefined {
	return resolvePipelineRoleProviderConfig('embedding', settings.embeddingProviderRole);
}

export type EmbeddingProviderConfig = NonNullable<ReturnType<typeof getEmbeddingProviderConfig>>;

export function getReviewerProviderConfig(): ProviderConfig | undefined {
	return resolvePipelineRoleProviderConfig('reviewer', settings.reviewerProviderRole);
}

export type ReviewerProviderConfig = NonNullable<ReturnType<typeof getReviewerProviderConfig>>;

export function getPlotPlannerProviderConfig(): ProviderConfig | undefined {
	return resolvePipelineRoleProviderConfig('plotPlanner', settings.plotPlannerProviderRole);
}

export type PlotPlannerProviderConfig = NonNullable<ReturnType<typeof getPlotPlannerProviderConfig>>;

export function getWriterProviderConfig(): ProviderConfig | undefined {
	return resolvePipelineRoleProviderConfig('writer', settings.writerProviderRole);
}

export type WriterProviderConfig = NonNullable<ReturnType<typeof getWriterProviderConfig>>;

export function getEditorProviderConfig(): ProviderConfig | undefined {
	return resolvePipelineRoleProviderConfig('editor', settings.editorProviderRole);
}

export type EditorProviderConfig = NonNullable<ReturnType<typeof getEditorProviderConfig>>;

export function getGameMasterProviderConfig(): ProviderConfig | undefined {
	return resolvePipelineRoleProviderConfig('gameMaster', settings.gameMasterProviderRole);
}

export type GameMasterProviderConfig = NonNullable<ReturnType<typeof getGameMasterProviderConfig>>;

export function getSummarizerProviderConfig(): ProviderConfig | undefined {
	return resolvePipelineRoleProviderConfig('summarizer', settings.summarizerProviderRole);
}

export type SummarizerProviderConfig = NonNullable<ReturnType<typeof getSummarizerProviderConfig>>;

export function getMinorTaskAgentProviderConfig(): ProviderConfig | undefined {
	return resolvePipelineRoleProviderConfig('minorTaskAgent', settings.minorTaskAgentProviderRole);
}

export type MinorTaskAgentProviderConfig = NonNullable<ReturnType<typeof getMinorTaskAgentProviderConfig>>;

export function isPhraseHighlightingEnabled(): boolean {
	return settings.importantPhraseHighlighting && !!getMinorTaskAgentProviderConfig();
}

export function getTTSVoiceByLocale(locale: Locale): VoiceId | null {
	return settings.ttsVoices[locale] ?? null;
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

export function isInventoryAvailable(): boolean {
	return settings.inventoryEnabled;
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

export function getCharacterNameSuggestionMode(): CharacterNameSuggestionMode {
	return settings.characterNameSuggestionMode;
}

export function getNameSuggestionQuotas(): NameQuotaConfig {
	const quotas = settings.nameSuggestionQuotas;
	if (!quotas) return DEFAULT_NAME_QUOTAS;
	return { budgets: quotas.budgets ?? {}, ratio: quotas.ratio ?? DEFAULT_NAME_QUOTAS.ratio };
}

export function getProviderConfigForRole(role: string): ProviderConfig | undefined {
	const id = settings.roleAssignments[role];
	if (!id) return undefined;
	const config = getProviderConfig(id);
	if (!config) return undefined;
	return applyRoleCallSettings(config, role);
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

export function getRoleCallSettings(role: string): LanguageModelCallOptions | undefined {
	return settings.roleCallSettings[role];
}

/** Pass `undefined` to remove the override (role falls back to its provider's settings) */
export function setRoleCallSettings(role: string, callSettings: LanguageModelCallOptions | undefined): void {
	const current = settings.roleCallSettings[role];
	if (callSettings === undefined) {
		if (current === undefined) return;
		delete settings.roleCallSettings[role];
	} else {
		// Skip no-op writes: a fresh reference would re-trigger reactive readers
		if (isEqual(current, callSettings)) return;
		settings.roleCallSettings[role] = callSettings;
	}
	persist();
}

type UpdatableSettings = Omit<Settings, 'providers' | 'roleAssignments' | 'roleCallSettings'>;

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

	// Sync log level to the logging layer and Rust backend
	if (partial.logLevel !== undefined && partial.logLevel !== prevLogLevel) {
		setLogLevel(partial.logLevel);
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
	Object.assign(settings, { ...createDefaults() });
	setLogLevel(settings.logLevel);
	persist();
}
