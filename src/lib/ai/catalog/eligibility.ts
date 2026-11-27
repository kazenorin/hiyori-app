import { OPENAI_BASE_URL, OPENROUTER_BASE_URL } from '#lib/ai/provider/constants.ts';
import type { Provider, ApiType } from '#lib/stores/settings.svelte.ts';

export const SUPPORTED_NPM = new Set(['@ai-sdk/openai-compatible', '@ai-sdk/openai', '@openrouter/ai-sdk-provider']);

const NPM_TO_TYPE: Record<string, Provider> = {
	'@ai-sdk/openai-compatible': 'openai-compatible',
	'@ai-sdk/openai': 'openai',
	'@openrouter/ai-sdk-provider': 'openrouter',
};

const ENDPOINT_DEFAULTS: Record<string, string> = {
	'@ai-sdk/openai': OPENAI_BASE_URL,
	'@openrouter/ai-sdk-provider': OPENROUTER_BASE_URL,
};

interface ProviderLike {
	id: string;
	name: string;
	npm: string;
	api?: string;
	env: string[];
	doc: string;
}

interface ModelLike {
	id: string;
	name: string;
	type?: string;
	status?: string;
	provider?: { npm?: string; api?: string; shape?: string };
}

export function isEligibleProvider(p: ProviderLike): boolean {
	return SUPPORTED_NPM.has(p.npm);
}

export function isEligibleModel(p: ProviderLike, m: ModelLike): boolean {
	if (m.type !== undefined && m.type !== 'chat') return false;
	const effectiveNpm = m.provider?.npm ?? p.npm;
	return SUPPORTED_NPM.has(effectiveNpm);
}

export function resolveProviderType(npm: string): Provider {
	return NPM_TO_TYPE[npm] ?? 'openai-compatible';
}

export function resolveEndpoint(p: ProviderLike): string {
	return p.api ?? ENDPOINT_DEFAULTS[p.npm] ?? '';
}

export function resolveModelWiring(p: ProviderLike, m: ModelLike): { providerType: Provider; apiType: ApiType; baseURL?: string } {
	const effectiveNpm = m.provider?.npm ?? p.npm;
	const providerType = resolveProviderType(effectiveNpm);
	const apiType: ApiType = m.provider?.shape === 'responses' && effectiveNpm === '@ai-sdk/openai' ? 'responses' : 'chat-completions';
	const providerEndpoint = resolveEndpoint(p);
	const modelApi = m.provider?.api;
	const baseURL = modelApi && modelApi !== providerEndpoint ? modelApi : undefined;
	return { providerType, apiType, baseURL };
}
