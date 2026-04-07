export type Provider = 'openai' | 'openai-compatible';
export type ApiType = 'chat-completions' | 'responses';

export interface Settings {
	provider: Provider;
	apiType: ApiType;
	baseURL: string;
	model: string;
	apiKey: string;
}

const STORAGE_KEY = 'byoa-settings';

const defaults: Settings = {
	provider: 'openai',
	apiType: 'responses',
	baseURL: 'https://api.openai.com/v1',
	model: 'gpt-4o',
	apiKey: ''
};

function loadSettings(): Settings {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) {
			return { ...defaults, ...JSON.parse(stored) };
		}
	} catch {
		// Invalid JSON or localStorage unavailable — use defaults
	}
	return { ...defaults };
}

function persist(): void {
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
	}
}

let settings = $state<Settings>(loadSettings());

export function getSettings(): Settings {
	return settings;
}

export function updateSettings(partial: Partial<Settings>): void {
	const prev = settings;
	let updated = { ...prev, ...partial };

	// Reset baseURL to provider default when provider changes
	if (partial.provider && partial.provider !== prev.provider) {
		if (updated.provider === 'openai') {
			updated = { ...updated, baseURL: 'https://api.openai.com/v1' };
		} else if (updated.provider === 'openai-compatible') {
			updated = { ...updated, baseURL: '' };
		}
	}

	settings = updated;
	persist();
}
