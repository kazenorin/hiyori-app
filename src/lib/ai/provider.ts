import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOllama } from 'ai-sdk-ollama';
import type { ProviderConfig } from '$lib/stores/settings.svelte';
import { fetch } from '@tauri-apps/plugin-http';
import { ERR_API_KEY_NOT_CONFIGURED } from '$lib/definitions/error-messages';

export function createModel(config: ProviderConfig) {
	if (!config.apiKey) {
		throw new Error(ERR_API_KEY_NOT_CONFIGURED);
	}

	const baseURL = config.baseURL || 'https://api.openai.com/v1';

	if (config.provider === 'ollama') {
		const provider = createOllama({ baseURL, apiKey: config.apiKey, fetch });
		return provider.chat(config.model);
	}

	if (config.provider === 'openai-compatible') {
		const provider = createOpenAICompatible({
			name: config.name || 'openai-compatible',
			baseURL,
			fetch,
			apiKey: config.apiKey,
		});
		return provider.chatModel(config.model);
	}

	const provider = createOpenAI({
		apiKey: config.apiKey,
		baseURL,
		fetch,
	});

	if (config.apiType === 'chat-completions') {
		return provider.chat(config.model);
	}

	return provider.responses(config.model);
}

export function createEmbeddingModel(config: ProviderConfig) {
	if (!config.apiKey) {
		throw new Error(ERR_API_KEY_NOT_CONFIGURED);
	}

	const baseURL = config.baseURL || 'https://api.openai.com/v1';

	if (config.provider === 'ollama') {
		const provider = createOllama({ baseURL, apiKey: config.apiKey, fetch });
		return provider.embedding(config.model);
	}

	if (config.provider === 'openai-compatible') {
		const provider = createOpenAICompatible({
			name: config.name || 'openai-compatible',
			baseURL,
			apiKey: config.apiKey,
		});
		return provider.embeddingModel(config.model);
	}

	const provider = createOpenAI({
		apiKey: config.apiKey,
		baseURL,
	});

	return provider.embeddingModel(config.model);
}
