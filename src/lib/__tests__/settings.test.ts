import { describe, it, expect, vi } from 'vitest';

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

import { getSettings, updateSettings } from '$lib/stores/settings.svelte';
import { invoke } from '@tauri-apps/api/core';

const STORAGE_KEY = 'byoa-settings';

describe('settings', () => {
	it('returns defaults when localStorage is empty', () => {
		localStorage.removeItem(STORAGE_KEY);
		// Note: settings is a singleton module, so defaults are already loaded
		// We verify the shape matches expected defaults
		const settings = getSettings();
		expect(settings).toHaveProperty('provider');
		expect(settings).toHaveProperty('apiType');
		expect(settings).toHaveProperty('baseURL');
		expect(settings).toHaveProperty('model');
		expect(settings).toHaveProperty('apiKey');
		expect(settings).toHaveProperty('logLevel');
	});

	it('updates a single field', async () => {
		await updateSettings({ apiKey: 'sk-test-key-' + Date.now() });
		const settings = getSettings();
		expect(settings.apiKey).toMatch(/^sk-test-key-/);
	});

	it('persists to localStorage', async () => {
		const model = 'test-model-' + Date.now();
		await updateSettings({ model });
		const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
		expect(stored.model).toBe(model);
	});

	it('resets baseURL when switching to openai provider', async () => {
		await updateSettings({ provider: 'openai-compatible' });
		await updateSettings({ baseURL: 'http://localhost:11434/v1' });
		expect(getSettings().baseURL).toBe('http://localhost:11434/v1');

		await updateSettings({ provider: 'openai' });
		expect(getSettings().baseURL).toBe('https://api.openai.com/v1');
	});

	it('resets baseURL to empty when switching to openai-compatible', async () => {
		await updateSettings({ provider: 'openai-compatible' });
		expect(getSettings().baseURL).toBe('');
	});

	it('does not reset baseURL when updating other fields', async () => {
		await updateSettings({ baseURL: 'http://custom.api/v1' });
		await updateSettings({ model: 'gpt-4' });
		expect(getSettings().baseURL).toBe('http://custom.api/v1');
	});

	it('syncs logLevel to Rust backend on change', async () => {
		const mockInvoke = vi.mocked(invoke);
		mockInvoke.mockClear();
		await updateSettings({ logLevel: 'debug' });
		expect(mockInvoke).toHaveBeenCalledWith('set_log_level', { level: 'debug' });
	});
});
