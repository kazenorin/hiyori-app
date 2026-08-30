// Canonical provider base URLs and OpenRouter app-attribution headers.
// Single source of truth for the provider form defaults and the model factory.

/** LM Studio's local OpenAI-compatible endpoint (default for the openai-compatible type). */
export const LMSTUDIO_BASE_URL = 'http://localhost:1234/v1';
export const OLLAMA_BASE_URL = 'https://ollama.com';
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// OpenRouter app attribution (https://openrouter.ai/docs/app-attribution).
// HTTP-Referer is required to register the app; categories are capped at 2 per request.
// Sent by both the native openrouter provider and the openai-compatible provider pointed at openrouter.ai.
export const OPENROUTER_ATTRIBUTION_HEADERS = {
	'X-OpenRouter-Title': 'Hiyori App',
	'HTTP-Referer': 'https://kazenorin.github.io/hiyori-app',
	'X-OpenRouter-Categories': 'roleplay,creative-writing',
};

/** True when the base URL's host is openrouter.ai (used to attach attribution headers to compatible calls). */
export function isOpenRouterBaseUrl(baseURL: string): boolean {
	try {
		return new URL(baseURL).hostname === 'openrouter.ai';
	} catch {
		return false;
	}
}
