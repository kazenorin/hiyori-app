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
	setLogLevel: vi.fn(),
}));

// Mock uuid to return predictable values
let uuidCounter = 0;
vi.mock('uuid', () => ({
	v4: () => `test-uuid-${++uuidCounter}`,
}));

const STORAGE_KEY = 'hiyori-settings';

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
			wispProxyUrl: 'ws://localhost:6001',
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
			wispProxyUrl: 'ws://localhost:6001',
		});
		const c2 = addProviderConfig({
			name: 'Second',
			provider: 'openai-compatible',
			apiType: 'chat-completions',
			baseURL: 'http://localhost:11434/v1',
			model: 'llama3',
			apiKey: '',
			corsBypassEnabled: false,
			wispProxyUrl: 'ws://localhost:6001',
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
			wispProxyUrl: 'ws://localhost:6001',
		});
		const c2 = addProviderConfig({
			name: 'Other',
			provider: 'openai-compatible',
			apiType: 'chat-completions',
			baseURL: '',
			model: 'llama3',
			apiKey: '',
			corsBypassEnabled: false,
			wispProxyUrl: 'ws://localhost:6001',
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
			wispProxyUrl: 'ws://localhost:6001',
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
			wispProxyUrl: 'ws://localhost:6001',
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
			wispProxyUrl: 'ws://localhost:6001',
		});
		assignRole('main', config.id);

		const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
		expect(stored.providers).toHaveLength(1);
		expect(stored.roleAssignments.main).toBe(config.id);
	});

	it('syncs logLevel to logging layer and Rust backend on change', async () => {
		vi.resetModules();
		const { updateSettings } = await import('$lib/stores/settings.svelte');
		const { invoke } = await import('@tauri-apps/api/core');
		const { setLogLevel } = await import('$lib/logging/logger');
		const mockInvoke = vi.mocked(invoke);
		const mockSetLogLevel = vi.mocked(setLogLevel);
		mockInvoke.mockClear();
		mockSetLogLevel.mockClear();

		await updateSettings({ logLevel: 'debug' });
		expect(mockSetLogLevel).toHaveBeenCalledWith('debug');
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
			wispProxyUrl: 'ws://localhost:6001',
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
			wispProxyUrl: 'ws://localhost:6001',
		});

		expect(copy.id).not.toBe(original.id);
		expect(copy.name).toBe('My Provider (copy)');
		expect(copy.provider).toBe('openai');
		expect(copy.apiKey).toBe('sk-test');
		expect(getSettings().providers).toHaveLength(2);
	});

	describe('role Advanced Settings overrides', () => {
		async function setup() {
			vi.resetModules();
			const mod = await import('$lib/stores/settings.svelte');
			const config = mod.addProviderConfig({
				name: 'Main',
				provider: 'openai',
				apiType: 'responses',
				baseURL: '',
				model: 'gpt-4o',
				apiKey: 'sk-test',
				corsBypassEnabled: false,
				wispProxyUrl: 'ws://localhost:6001',
				callSettings: { temperature: 0.5, reasoning: 'high' },
			});
			mod.assignRole('main', config.id);
			return mod;
		}

		it('pipeline role without override follows the provider callSettings', async () => {
			const mod = await setup();
			expect(mod.getWriterProviderConfig()?.callSettings).toEqual({ temperature: 0.5, reasoning: 'high' });
		});

		it('pipeline role override replaces the provider callSettings entirely', async () => {
			const mod = await setup();
			mod.setRoleCallSettings('writer', { reasoning: 'low' });
			// Block-replace semantics: the provider's temperature must not leak through
			expect(mod.getWriterProviderConfig()?.callSettings).toEqual({ reasoning: 'low' });
		});

		it('an enabled but empty override disables all advanced settings', async () => {
			const mod = await setup();
			mod.setRoleCallSettings('writer', {});
			expect(mod.getWriterProviderConfig()?.callSettings).toEqual({});
		});

		it('pipeline role assigned to main inherits the main role override', async () => {
			const mod = await setup();
			mod.setRoleCallSettings('main', { temperature: 0.9 });
			expect(mod.getWriterProviderConfig()?.callSettings).toEqual({ temperature: 0.9 });
		});

		it('pipeline role own override takes precedence over the main role override', async () => {
			const mod = await setup();
			mod.setRoleCallSettings('main', { temperature: 0.9 });
			mod.setRoleCallSettings('writer', { topP: 0.5 });
			expect(mod.getWriterProviderConfig()?.callSettings).toEqual({ topP: 0.5 });
		});

		it('getMainProviderConfig applies the main role override', async () => {
			const mod = await setup();
			mod.setRoleCallSettings('main', { reasoning: 'minimal' });
			expect(mod.getMainProviderConfig()?.callSettings).toEqual({ reasoning: 'minimal' });
		});

		it('removing an override restores fallback to provider settings', async () => {
			const mod = await setup();
			mod.setRoleCallSettings('writer', { topK: 5 });
			mod.setRoleCallSettings('writer', undefined);
			expect(mod.getWriterProviderConfig()?.callSettings).toEqual({ temperature: 0.5, reasoning: 'high' });

			const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
			expect(stored.roleCallSettings.writer).toBeUndefined();
		});

		it('persists roleCallSettings to localStorage', async () => {
			const mod = await setup();
			mod.setRoleCallSettings('reviewer', { reasoning: 'high' });

			const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
			expect(stored.roleCallSettings.reviewer).toEqual({ reasoning: 'high' });
		});

		it('equal-value writes keep the same reference so reactive readers are not re-triggered', async () => {
			const mod = await setup();
			mod.setRoleCallSettings('main', {});
			const before = mod.getRoleCallSettings('main');
			mod.setRoleCallSettings('main', {});
			expect(mod.getRoleCallSettings('main')).toBe(before);

			mod.setRoleCallSettings('main', { temperature: 0.5 });
			const withTemp = mod.getRoleCallSettings('main');
			mod.setRoleCallSettings('main', { temperature: 0.5 });
			expect(mod.getRoleCallSettings('main')).toBe(withTemp);
		});
	});
});
