import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ProviderConfig } from '$lib/stores/settings.svelte';

export function createModel(config: ProviderConfig) {
	if (!config.apiKey) {
		throw new Error('API key not configured. Please set it in Settings.');
	}

	const baseURL = config.baseURL || 'https://api.openai.com/v1';

	if (config.provider === 'openai-compatible') {
		const provider = createOpenAICompatible({
			name: config.name || 'openai-compatible',
			baseURL,
			apiKey: config.apiKey,
		});
		return provider.chatModel(config.model);
	}

	const provider = createOpenAI({
		apiKey: config.apiKey,
		baseURL,
	});

	if (config.apiType === 'chat-completions') {
		return provider.chat(config.model);
	}

	return provider.responses(config.model);
}

export function createEmbeddingModel(config: ProviderConfig) {
	if (!config.apiKey) {
		throw new Error('API key not configured. Please set it in Settings.');
	}

	const baseURL = config.baseURL || 'https://api.openai.com/v1';

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
