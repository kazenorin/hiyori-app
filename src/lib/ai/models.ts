import { fetch } from '@tauri-apps/plugin-http';
import type { Provider } from '$lib/stores/settings.svelte';

export interface ModelInfo {
	id: string;
	owned_by: string;
	created: number;
}

const FETCH_TIMEOUT_MS = 10000;

export async function fetchModels(settings: { baseURL: string; apiKey: string; provider: Provider }): Promise<ModelInfo[]> {
	if (settings.provider === 'ollama') {
		return fetchOllamaModels(settings);
	}

	const baseURL = settings.baseURL || 'https://api.openai.com/v1';
	const url = `${baseURL}/models`;

	const headers: Record<string, string> = {};
	if (settings.apiKey) {
		headers['Authorization'] = `Bearer ${settings.apiKey}`;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(url, { headers, signal: controller.signal });

		if (!response.ok) {
			throw new Error(`Failed to fetch models (${response.status})`);
		}

		const data = await response.json();

		if (!Array.isArray(data.data)) {
			throw new Error('Invalid response format from models API');
		}

		return Array.from(
			new Map((data.data as ModelInfo[]).map((item) => [item.id, item])).values()
		).sort((a, b) => a.id.localeCompare(b.id));
	} finally {
		clearTimeout(timeoutId);
	}
}

async function fetchOllamaModels(settings: { baseURL: string; apiKey: string; provider: Provider }): Promise<ModelInfo[]> {
	const baseURL = settings.baseURL || 'https://ollama.com';
	const url = `${baseURL}/api/tags`;

	const headers: Record<string, string> = {};
	if (settings.apiKey) {
		headers['Authorization'] = `Bearer ${settings.apiKey}`;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(url, { headers, signal: controller.signal });

		if (!response.ok) {
			throw new Error(`Failed to fetch models (${response.status})`);
		}

		const data = await response.json();

		if (!Array.isArray(data.models)) {
			throw new Error('Invalid response format from Ollama API');
		}

		return (data.models as Array<{ name: string; modified_at: string }>)
			.map((m) => ({
				id: m.name,
				owned_by: 'ollama',
				created: 0,
			}))
			.sort((a, b) => a.id.localeCompare(b.id));
	} finally {
		clearTimeout(timeoutId);
	}
}
