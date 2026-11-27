import type { Provider, ApiType } from '#lib/stores/settings.svelte.ts';
import type { LanguageModelCallOptions } from 'ai';

/** Mirrors @opencode-ai/models ReasoningOption without runtime import. */
export type ReasoningEffortValue = null | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'default';
export type ReasoningOption =
	{ type: 'toggle' } | { type: 'effort'; values: ReasoningEffortValue[] } | { type: 'budget_tokens'; min?: number; max?: number };

export interface ModelSnapshot {
	name: string;
	reasoning: boolean;
	tool_call: boolean;
	attachment: boolean;
	context: number;
	status?: 'alpha' | 'beta' | 'deprecated';
	reasoning_options?: ReasoningOption[];
	temperature?: boolean;
}

export interface CatalogModelEntry {
	id: string;
	modelId: string;
	providerType: Provider;
	apiType: ApiType;
	baseURL?: string;
	snapshot: ModelSnapshot;
	callSettings?: LanguageModelCallOptions;
	reasoningToggle?: 'on' | 'off';
	reasoningBudget?: number;
}

export interface CatalogProviderEntity {
	id: string;
	catalogId: string;
	displayName: string;
	apiKey?: string;
	baseURL: string;
	corsBypassEnabled: boolean;
	wispProxyUrl: string;
	enabledModels: CatalogModelEntry[];
}

/** Filtered provider shape emitted by the build script and the runtime service. */
export interface EligibleModel {
	id: string;
	name: string;
	reasoning: boolean;
	tool_call: boolean;
	attachment: boolean;
	status?: 'alpha' | 'beta' | 'deprecated';
	release_date: string;
	context: number;
	reasoning_options?: ReasoningOption[];
	temperature?: boolean;
	provider?: { npm?: string; api?: string; shape?: 'responses' | 'completions' };
}

export interface EligibleProvider {
	id: string;
	name: string;
	npm: string;
	api?: string;
	env: string[];
	doc: string;
	models: EligibleModel[];
}

export interface CatalogResult {
	providers: EligibleProvider[];
	generatedAt: string;
	source: 'live' | 'cache' | 'bundled';
}
