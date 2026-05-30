import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(async () => {}),
}));

// Mock logger
vi.mock('$lib/logging/logger', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {}),
	},
	fileLog: vi.fn(async () => {}),
}));

// Mock uuid to return predictable values
let uuidCounter = 0;
vi.mock('uuid', () => ({
	v4: () => `test-uuid-${++uuidCounter}`,
}));

const STORAGE_KEY = 'byoa-settings';

// Re-import for each test to reset module state
describe('settings', () => {
	beforeEach(() => {
		localStorage.removeItem(STORAGE_KEY);
		uuidCounter = 0;
	});

	it('returns defaults when localStorage is empty', async () => {
		vi.resetModules();
		const { getSettings } = await import('$lib/stores/settings.svelte');
		const settings = getSettings();

		expect(settings.providers).toEqual([]);
		expect(settings.roleAssignments).toEqual({});
		expect(settings.logLevel).toBe('info');
		expect(settings.fontSize).toBe(1.0);
	});

	it('addProviderConfig creates a config with UUID', async () => {
		vi.resetModules();
		const { addProviderConfig, getSettings } = await import('$lib/stores/settings.svelte');
		const config = addProviderConfig({
			name: 'Test Provider',
			provider: 'openai',
			apiType: 'responses',
			baseURL: 'https://api.openai.com/v1',
			model: 'gpt-4o',
			apiKey: 'sk-test',
			corsBypassEnabled: false,
			wispProxyUrl: '',
		});

		expect(config.id).toBe('test-uuid-1');
		expect(config.name).toBe('Test Provider');
		expect(getSettings().providers).toHaveLength(1);
	});

	it('updateProviderConfig updates the correct config', async () => {
		vi.resetModules();
		const { addProviderConfig, updateProviderConfig, getProviderConfig } = await import('$lib/stores/settings.svelte');
		const c1 = addProviderConfig({
			name: 'First',
			provider: 'openai',
			apiType: 'responses',
			baseURL: '',
			model: 'gpt-4o',
			apiKey: 'sk-1',
			corsBypassEnabled: false,
			wispProxyUrl: '',
		});
		const c2 = addProviderConfig({
			name: 'Second',
			provider: 'openai-compatible',
			apiType: 'chat-completions',
			baseURL: 'http://localhost:11434/v1',
			model: 'llama3',
			apiKey: '',
			corsBypassEnabled: false,
			wispProxyUrl: '',
		});

		updateProviderConfig(c1.id, { apiKey: 'sk-updated' });

		expect(getProviderConfig(c1.id)?.apiKey).toBe('sk-updated');
		expect(getProviderConfig(c2.id)?.apiKey).toBe(''); // unchanged
	});

	it('deleteProviderConfig removes config and cleans up role assignments', async () => {
		vi.resetModules();
		const { addProviderConfig, assignRole, deleteProviderConfig, getSettings } = await import('$lib/stores/settings.svelte');
		const c1 = addProviderConfig({
			name: 'Main',
			provider: 'openai',
			apiType: 'responses',
			baseURL: '',
			model: 'gpt-4o',
			apiKey: 'sk-1',
			corsBypassEnabled: false,
			wispProxyUrl: '',
		});
		const c2 = addProviderConfig({
			name: 'Other',
			provider: 'openai-compatible',
			apiType: 'chat-completions',
			baseURL: '',
			model: 'llama3',
			apiKey: '',
			corsBypassEnabled: false,
			wispProxyUrl: '',
		});

		assignRole('main', c1.id);
		expect(getSettings().roleAssignments['main']).toBe(c1.id);

		deleteProviderConfig(c1.id);

		expect(getSettings().providers).toHaveLength(1);
		expect(getSettings().providers[0].id).toBe(c2.id);
		expect(getSettings().roleAssignments['main']).toBeUndefined();
	});

	it('getMainProviderConfig returns the config assigned to main role', async () => {
		vi.resetModules();
		const { addProviderConfig, assignRole, getMainProviderConfig } = await import('$lib/stores/settings.svelte');
		const config = addProviderConfig({
			name: 'Main',
			provider: 'openai',
			apiType: 'responses',
			baseURL: '',
			model: 'gpt-4o',
			apiKey: 'sk-test',
			corsBypassEnabled: false,
			wispProxyUrl: '',
		});
		assignRole('main', config.id);

		const main = getMainProviderConfig();
		expect(main?.id).toBe(config.id);
		expect(main?.name).toBe('Main');
	});

	it('getMainProviderConfig returns undefined when no main is assigned', async () => {
		vi.resetModules();
		const { getMainProviderConfig } = await import('$lib/stores/settings.svelte');
		expect(getMainProviderConfig()).toBeUndefined();
	});

	it('assignRole correctly updates the map', async () => {
		vi.resetModules();
		const { addProviderConfig, assignRole, getSettings } = await import('$lib/stores/settings.svelte');
		const config = addProviderConfig({
			name: 'Test',
			provider: 'openai',
			apiType: 'responses',
			baseURL: '',
			model: 'gpt-4o',
			apiKey: 'sk-test',
			corsBypassEnabled: false,
			wispProxyUrl: '',
		});

		assignRole('embedding', config.id);
		expect(getSettings().roleAssignments['embedding']).toBe(config.id);
	});

	it('persists to localStorage', async () => {
		vi.resetModules();
		const { addProviderConfig, assignRole } = await import('$lib/stores/settings.svelte');
		const config = addProviderConfig({
			name: 'Test',
			provider: 'openai',
			apiType: 'responses',
			baseURL: '',
			model: 'gpt-4o',
			apiKey: 'sk-test',
			corsBypassEnabled: false,
			wispProxyUrl: '',
		});
		assignRole('main', config.id);

		const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
		expect(stored.providers).toHaveLength(1);
		expect(stored.roleAssignments.main).toBe(config.id);
	});

	it('syncs logLevel to Rust backend on change', async () => {
		vi.resetModules();
		const { updateSettings } = await import('$lib/stores/settings.svelte');
		const { invoke } = await import('@tauri-apps/api/core');
		const mockInvoke = vi.mocked(invoke);
		mockInvoke.mockClear();

		await updateSettings({ logLevel: 'debug' });
		expect(mockInvoke).toHaveBeenCalledWith('set_log_level', { level: 'debug' });
	});

	it('duplicate copies provider with new id and (copy) suffix', async () => {
		vi.resetModules();
		const { addProviderConfig, getSettings } = await import('$lib/stores/settings.svelte');
		const original = addProviderConfig({
			name: 'My Provider',
			provider: 'openai',
			apiType: 'responses',
			baseURL: 'https://api.openai.com/v1',
			model: 'gpt-4o',
			apiKey: 'sk-test',
			corsBypassEnabled: false,
			wispProxyUrl: '',
		});

		// Simulate duplicate like the UI does
		const copy = addProviderConfig({
			name: original.name + ' (copy)',
			provider: original.provider,
			apiType: original.apiType,
			baseURL: original.baseURL,
			model: original.model,
			apiKey: original.apiKey,
			corsBypassEnabled: false,
			wispProxyUrl: '',
		});

		expect(copy.id).not.toBe(original.id);
		expect(copy.name).toBe('My Provider (copy)');
		expect(copy.provider).toBe('openai');
		expect(copy.apiKey).toBe('sk-test');
		expect(getSettings().providers).toHaveLength(2);
	});
});
