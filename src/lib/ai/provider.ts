import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOllama } from 'ai-sdk-ollama';
import type { ProviderConfig } from '$lib/stores/settings.svelte';
import { fetch, resolveFetch } from '$lib/http/fetch';
import { ERR_API_KEY_NOT_CONFIGURED } from '$lib/definitions/error-messages';

export async function createModel(config: ProviderConfig) {
	const baseURL = config.baseURL || 'https://api.openai.com/v1';
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
	const baseURL = config.baseURL || 'https://api.openai.com/v1';
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
