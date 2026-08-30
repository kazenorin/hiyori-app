import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOllama } from 'ai-sdk-ollama';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { ProviderConfig } from '$lib/stores/settings.svelte';
import { resolveFetch } from '$lib/http/fetch';
import { ERR_API_KEY_NOT_CONFIGURED } from '$lib/definitions/error-messages';

// OpenRouter app attribution (https://openrouter.ai/docs/app-attribution).
// appName -> X-OpenRouter-Title, appUrl -> HTTP-Referer (required to register the app),
// headers -> X-OpenRouter-Categories (max 2 per request).
const OPENROUTER_ATTRIBUTION = {
	appName: 'Hiyori App',
	appUrl: 'https://github.com/kazenorin/hiyori-app',
	headers: { 'X-OpenRouter-Categories': 'roleplay,creative-writing' },
};

export async function createModel(config: ProviderConfig) {
	const baseURL = (config.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '');
	const providerFetch = await resolveFetch(config.corsBypassEnabled, config.wispProxyUrl);

	if (config.provider === 'ollama') {
		const provider = createOllama({ baseURL, apiKey: config.apiKey, fetch: providerFetch });
		return provider.chat(config.model);
	}

	if (config.provider === 'openai-compatible') {
		const provider = createOpenAICompatible({
			name: config.name || 'openai-compatible',
			baseURL,
			fetch: providerFetch,
			apiKey: config.apiKey,
		});
		return provider.chatModel(config.model);
	}

	if (config.provider === 'openrouter') {
		if (!config.apiKey) {
			throw new Error(ERR_API_KEY_NOT_CONFIGURED);
		}
		// The OpenRouter SDK ignores the standard `reasoning` call option, so map the
		// selected effort into the model settings it does read (provider-default => omit).
		const effort = config.callSettings?.reasoning;
		// strict mode sends stream_options.include_usage, which the pipeline's usage reporting relies on
		const provider = createOpenRouter({
			baseURL,
			apiKey: config.apiKey,
			fetch: providerFetch,
			compatibility: 'strict',
			...OPENROUTER_ATTRIBUTION,
		});
		return provider.chat(config.model, effort && effort !== 'provider-default' ? { reasoning: { effort } } : undefined);
	}

	if (!config.apiKey) {
		throw new Error(ERR_API_KEY_NOT_CONFIGURED);
	}

	const provider = createOpenAI({
		apiKey: config.apiKey,
		baseURL,
		fetch: providerFetch,
	});

	if (config.apiType === 'chat-completions') {
		return provider.chat(config.model);
	}

	return provider.responses(config.model);
}

export async function createEmbeddingModel(config: ProviderConfig) {
	const baseURL = (config.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '');
	const providerFetch = await resolveFetch(config.corsBypassEnabled, config.wispProxyUrl);

	if (config.provider === 'ollama') {
		const provider = createOllama({ baseURL, apiKey: config.apiKey, fetch: providerFetch });
		return provider.embedding(config.model);
	}

	if (config.provider === 'openai-compatible') {
		const provider = createOpenAICompatible({
			name: config.name || 'openai-compatible',
			baseURL,
			fetch: providerFetch,
			apiKey: config.apiKey,
		});
		return provider.embeddingModel(config.model);
	}

	if (config.provider === 'openrouter') {
		if (!config.apiKey) {
			throw new Error(ERR_API_KEY_NOT_CONFIGURED);
		}
		const provider = createOpenRouter({
			baseURL,
			apiKey: config.apiKey,
			fetch: providerFetch,
			compatibility: 'strict',
			...OPENROUTER_ATTRIBUTION,
		});
		return provider.textEmbeddingModel(config.model);
	}

	if (!config.apiKey) {
		throw new Error(ERR_API_KEY_NOT_CONFIGURED);
	}

	const provider = createOpenAI({
		apiKey: config.apiKey,
		baseURL,
		fetch: providerFetch,
	});

	return provider.embeddingModel(config.model);
}
