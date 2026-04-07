import { createOpenAI } from '@ai-sdk/openai';
import type { Settings } from '$lib/stores/settings.svelte';

export function createModel(settings: Settings) {
	const baseURL = settings.baseURL || 'https://api.openai.com/v1';

	const provider = createOpenAI({
		apiKey: settings.apiKey || 'missing-key',
		baseURL
	});

	if (settings.apiType === 'chat-completions') {
		return provider.chat(settings.model);
	}

	return provider.responses(settings.model);
}
