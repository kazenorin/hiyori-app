export interface ModelInfo {
	id: string;
	owned_by: string;
	created: number;
}

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

	const response = await fetch(url, { headers });

	if (!response.ok) {
		throw new Error(`Failed to fetch models (${response.status})`);
	}

	const data = await response.json();
	return (data.data as ModelInfo[]).sort((a, b) => a.id.localeCompare(b.id));
}
