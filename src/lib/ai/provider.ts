import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { Settings } from '$lib/stores/settings.svelte';

export function createModel(settings: Settings) {
	if (!settings.apiKey) {
		throw new Error('API key not configured. Please set it in Settings.');
	}

	const baseURL = settings.baseURL || 'https://api.openai.com/v1';

	if (settings.provider === 'openai-compatible') {
		const provider = createOpenAICompatible({
			name: 'openai-compatible',
			baseURL,
			apiKey: settings.apiKey
		});
		return provider.chatModel(settings.model);
	}

	const provider = createOpenAI({
		apiKey: settings.apiKey,
		baseURL
	});

	if (settings.apiType === 'chat-completions') {
		return provider.chat(settings.model);
	}

	return provider.responses(settings.model);
}
