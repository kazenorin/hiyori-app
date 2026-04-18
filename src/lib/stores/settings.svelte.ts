import { v4 as uuidv4 } from 'uuid';

export type Provider = 'openai' | 'openai-compatible';
export type ApiType = 'chat-completions' | 'responses';
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

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
	apiKey: string;
}

export interface Settings {
	providers: ProviderConfig[];
	roleAssignments: Record<string, string>;
	logLevel: LogLevel;
	fontSize: number;
	memoryEnabled: boolean;
	memoryProviderRole: string;
	embeddingProviderRole: string;
	reviewerEnabled: boolean;
	reviewerProviderRole: string;
}

const STORAGE_KEY = 'byoa-settings';

const defaults: Settings = {
	providers: [],
	roleAssignments: {},
	logLevel: 'info',
	fontSize: 1.0,
	memoryEnabled: true,
	memoryProviderRole: 'main',
	embeddingProviderRole: 'main',
	reviewerEnabled: false,
	reviewerProviderRole: 'main'
};

/**
 * Migrate from the old flat settings shape to the new multi-provider shape.
 * Detects old shape by presence of `provider` as a string without `providers` array.
 */
function migrateFromFlatSettings(raw: Record<string, unknown>): Settings {
	const config: ProviderConfig = {
		id: uuidv4(),
		name: 'Default Provider',
		provider: (raw.provider as Provider) || 'openai',
		apiType: (raw.apiType as ApiType) || 'responses',
		baseURL: (raw.baseURL as string) || 'https://api.openai.com/v1',
		model: (raw.model as string) || 'gpt-4o',
		apiKey: (raw.apiKey as string) || ''
	};

	return {
		providers: [config],
		roleAssignments: { main: config.id },
		logLevel: (raw.logLevel as LogLevel) || 'info',
		fontSize: (raw.fontSize as number) ?? 1.0,
		memoryEnabled: (raw.memoryEnabled as boolean) ?? true,
		memoryProviderRole: (raw.memoryProviderRole as string) || 'main',
		embeddingProviderRole: (raw.embeddingProviderRole as string) || 'main',
		reviewerEnabled: (raw.reviewerEnabled as boolean) ?? false,
		reviewerProviderRole: (raw.reviewerProviderRole as string) || 'main'
	};
}

function isFlatSettings(raw: Record<string, unknown>): boolean {
	return typeof raw.provider === 'string' && !Array.isArray(raw.providers);
}

/**
 * Apply font size preference by setting the --text-scaling CSS variable.
 */
export function applyFontSizePreference(fontSize: number): void {
	if (typeof document !== 'undefined') {
		document.documentElement.style.setProperty('--text-scaling', String(fontSize));
	}
}

function loadSettings(): Settings {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) {
			const raw = JSON.parse(stored);
			if (isFlatSettings(raw)) {
				return migrateFromFlatSettings(raw);
			}
			return { ...defaults, ...raw };
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

export let settings = $state<Settings>(loadSettings());

/** Apply initial font size preference when store is initialized */
applyFontSizePreference(settings.fontSize);

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
	if (!config?.apiKey) return undefined;
	return config;
}

/** Resolved memory provider config type (non-nullable after successful resolution) */
export type MemoryProviderConfig = NonNullable<ReturnType<typeof getMemoryProviderConfig>>;


export function getEmbeddingProviderConfig(): ProviderConfig | undefined {
	const role = settings.embeddingProviderRole || 'main';
	const id = settings.roleAssignments[role];
	const config = id ? getProviderConfig(id) : getProviderConfig(role);
	if (!config?.apiKey) return undefined;
	return config;
}

export type EmbeddingProviderConfig = NonNullable<ReturnType<typeof getEmbeddingProviderConfig>>;

export function getReviewerProviderConfig(): ProviderConfig | undefined {
	const role = settings.reviewerProviderRole || 'main';
	const id = settings.roleAssignments[role];
	const config = id ? getProviderConfig(id) : getProviderConfig(role);
	if (!config?.apiKey) return undefined;
	return config;
}

export type ReviewerProviderConfig = NonNullable<ReturnType<typeof getReviewerProviderConfig>>;
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
	for (const [role, configId] of Object.entries(settings.roleAssignments)) {
		if (configId === id) {
			delete settings.roleAssignments[role];
		}
	}
	persist();
}

export function assignRole(role: string, providerConfigId: string): void {
	settings.roleAssignments[role] = providerConfigId;
	persist();
}

// --- Global Settings ---

export async function updateSettings(
	partial: Partial<Pick<Settings, 'logLevel' | 'fontSize' | 'memoryEnabled' | 'memoryProviderRole' | 'embeddingProviderRole' | 'reviewerEnabled' | 'reviewerProviderRole'>>
): Promise<void> {
	const prevFontSize = settings.fontSize;
	const prevLogLevel = settings.logLevel;

	if (partial.logLevel !== undefined) settings.logLevel = partial.logLevel;
	if (partial.fontSize !== undefined) settings.fontSize = partial.fontSize;
	if (partial.memoryEnabled !== undefined) settings.memoryEnabled = partial.memoryEnabled;
	if (partial.memoryProviderRole !== undefined) settings.memoryProviderRole = partial.memoryProviderRole;
	if (partial.embeddingProviderRole !== undefined) settings.embeddingProviderRole = partial.embeddingProviderRole;
	if (partial.reviewerEnabled !== undefined) settings.reviewerEnabled = partial.reviewerEnabled;
	if (partial.reviewerProviderRole !== undefined) settings.reviewerProviderRole = partial.reviewerProviderRole;
	persist();

	// Apply font size preference when fontSize changes
	if (partial.fontSize !== undefined && partial.fontSize !== prevFontSize) {
		applyFontSizePreference(settings.fontSize);
	}

	// Sync log level to Rust backend
	if (partial.logLevel !== undefined && partial.logLevel !== prevLogLevel) {
		try {
			const { invoke } = await import('@tauri-apps/api/core');
			await invoke('set_log_level', { level: partial.logLevel });
		} catch (err) {
			console.debug('Rust backend unavailable for log level sync:', err);
		}
	}
}
