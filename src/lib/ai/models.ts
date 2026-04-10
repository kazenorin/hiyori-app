export interface ModelInfo {
	id: string;
	owned_by: string;
	created: number;
}

const FETCH_TIMEOUT_MS = 10000;

export async function fetchModels(settings: {
	baseURL: string;
	apiKey: string;
}): Promise<ModelInfo[]> {
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

		return (data.data as ModelInfo[]).sort((a, b) => a.id.localeCompare(b.id));
	} finally {
		clearTimeout(timeoutId);
	}
}