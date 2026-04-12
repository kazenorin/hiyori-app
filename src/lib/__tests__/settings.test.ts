import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(async () => {})
}));

// Mock logger
vi.mock('$lib/logging/logger', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {})
	}
}));

// Mock uuid to return predictable values
let uuidCounter = 0;
vi.mock('uuid', () => ({
	v4: () => `test-uuid-${++uuidCounter}`
}));

const STORAGE_KEY = 'byoa-settings';

// Re-import for each test to reset module state
describe('settings', () => {
	beforeEach(() => {
		localStorage.removeItem(STORAGE_KEY);
		uuidCounter = 0;
	});

	it('migrates flat settings to multi-provider shape', async () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				provider: 'openai',
				apiType: 'responses',
				baseURL: 'https://api.openai.com/v1',
				model: 'gpt-4o',
				apiKey: 'sk-test-key',
				logLevel: 'debug',
				fontSize: 1.2
			})
		);

		// Force module re-import
		vi.resetModules();
		const { getSettings } = await import('$lib/stores/settings.svelte');
		const settings = getSettings();

		// Old fields should be gone, new shape present
		expect(settings.providers).toHaveLength(1);
		expect(settings.providers[0]).toEqual({
			id: expect.any(String),
			name: 'Default Provider',
			provider: 'openai',
			apiType: 'responses',
			baseURL: 'https://api.openai.com/v1',
			model: 'gpt-4o',
			apiKey: 'sk-test-key'
		});
		expect(settings.roleAssignments['main']).toBe(settings.providers[0].id);
		expect(settings.logLevel).toBe('debug');
		expect(settings.fontSize).toBe(1.2);
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
			apiKey: 'sk-test'
		});

		expect(config.id).toBe('test-uuid-1');
		expect(config.name).toBe('Test Provider');
		expect(getSettings().providers).toHaveLength(1);
	});

	it('updateProviderConfig updates the correct config', async () => {
		vi.resetModules();
		const { addProviderConfig, updateProviderConfig, getProviderConfig } = await import(
			'$lib/stores/settings.svelte'
		);
		const c1 = addProviderConfig({
			name: 'First',
			provider: 'openai',
			apiType: 'responses',
			baseURL: '',
			model: 'gpt-4o',
			apiKey: 'sk-1'
		});
		const c2 = addProviderConfig({
			name: 'Second',
			provider: 'openai-compatible',
			apiType: 'chat-completions',
			baseURL: 'http://localhost:11434/v1',
			model: 'llama3',
			apiKey: ''
		});

		updateProviderConfig(c1.id, { apiKey: 'sk-updated' });

		expect(getProviderConfig(c1.id)?.apiKey).toBe('sk-updated');
		expect(getProviderConfig(c2.id)?.apiKey).toBe(''); // unchanged
	});

	it('deleteProviderConfig removes config and cleans up role assignments', async () => {
		vi.resetModules();
		const { addProviderConfig, assignRole, deleteProviderConfig, getSettings } = await import(
			'$lib/stores/settings.svelte'
		);
		const c1 = addProviderConfig({
			name: 'Main',
			provider: 'openai',
			apiType: 'responses',
			baseURL: '',
			model: 'gpt-4o',
			apiKey: 'sk-1'
		});
		const c2 = addProviderConfig({
			name: 'Other',
			provider: 'openai-compatible',
			apiType: 'chat-completions',
			baseURL: '',
			model: 'llama3',
			apiKey: ''
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
		const { addProviderConfig, assignRole, getMainProviderConfig } = await import(
			'$lib/stores/settings.svelte'
		);
		const config = addProviderConfig({
			name: 'Main',
			provider: 'openai',
			apiType: 'responses',
			baseURL: '',
			model: 'gpt-4o',
			apiKey: 'sk-test'
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
		const { addProviderConfig, assignRole, getSettings } = await import(
			'$lib/stores/settings.svelte'
		);
		const config = addProviderConfig({
			name: 'Test',
			provider: 'openai',
			apiType: 'responses',
			baseURL: '',
			model: 'gpt-4o',
			apiKey: 'sk-test'
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
			apiKey: 'sk-test'
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
});
