import { describe, it, expect } from 'vitest';

import { createModel } from '$lib/ai/provider/provider';
import type { ProviderConfig } from '$lib/stores/settings.svelte';

/** Minimal OpenRouter config; only the fields relevant to the reasoning bridge vary per test. */
function openrouterConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
	return {
		id: 'p1',
		name: 'OpenRouter',
		provider: 'openrouter',
		apiType: 'chat-completions',
		baseURL: 'https://openrouter.ai/api/v1',
		model: 'anthropic/claude-sonnet-4',
		apiKey: 'sk-or-test',
		corsBypassEnabled: false,
		wispProxyUrl: 'ws://localhost:6001',
		...overrides,
	};
}

/** The OpenRouter chat model instance stores the settings passed to provider.chat(modelId, settings). */
type ModelWithSettings = { settings?: { reasoning?: { effort?: string } } };

describe('createModel — openrouter reasoning-effort bridge', () => {
	// The OpenRouter SDK ignores the AI SDK's standard top-level `reasoning` call option
	// (it only reads model-settings / providerOptions), so createModel must forward the
	// selected effort into the model settings the SDK actually consumes. If the bridge is
	// removed, effort selection silently stops reaching the request.
	it('maps the standard reasoning call option into OpenRouter model settings', async () => {
		const model = (await createModel(openrouterConfig({ callSettings: { reasoning: 'high' } }))) as unknown as ModelWithSettings;
		expect(model.settings?.reasoning?.effort).toBe('high');
	});

	it('forwards "none" so reasoning is explicitly disabled upstream', async () => {
		const model = (await createModel(openrouterConfig({ callSettings: { reasoning: 'none' } }))) as unknown as ModelWithSettings;
		expect(model.settings?.reasoning?.effort).toBe('none');
	});

	it('omits reasoning when the effort is provider-default', async () => {
		const model = (await createModel(
			openrouterConfig({ callSettings: { reasoning: 'provider-default' } })
		)) as unknown as ModelWithSettings;
		expect(model.settings?.reasoning).toBeUndefined();
	});

	it('omits reasoning when no call settings are set', async () => {
		const model = (await createModel(openrouterConfig())) as unknown as ModelWithSettings;
		expect(model.settings?.reasoning).toBeUndefined();
	});

	it('throws when no API key is configured', async () => {
		await expect(createModel(openrouterConfig({ apiKey: '' }))).rejects.toThrow();
	});
});

describe('createModel — openrouter app attribution headers', () => {
	// OpenRouter app attribution requires HTTP-Referer to register the app; Title and Categories
	// classify it in rankings. These are passed to createOpenRouter, so the built model's request
	// headers must carry all three. See https://openrouter.ai/docs/app-attribution
	it('sends X-OpenRouter-Title, HTTP-Referer and X-OpenRouter-Categories', async () => {
		type ModelWithConfigHeaders = { config?: { headers?: () => Record<string, string | undefined> } };
		const model = (await createModel(openrouterConfig())) as unknown as ModelWithConfigHeaders;
		const headers = model.config?.headers?.() ?? {};
		expect(headers['X-OpenRouter-Title']).toBe('Hiyori App');
		expect(headers['HTTP-Referer']).toBe('https://kazenorin.github.io/hiyori-app');
		expect(headers['X-OpenRouter-Categories']).toBe('roleplay,creative-writing');
	});
});

describe('createModel — openai-compatible pointed at OpenRouter', () => {
	// Users can reach OpenRouter via the openai-compatible type; only calls whose host is
	// openrouter.ai should carry the attribution headers.
	type ModelWithConfigHeaders = { config?: { headers?: () => Record<string, string | undefined> } };

	function compatConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
		return openrouterConfig({ provider: 'openai-compatible', name: 'OpenRouter via Compat', ...overrides });
	}

	async function requestHeaders(config: ProviderConfig): Promise<Record<string, string | undefined>> {
		const model = (await createModel(config)) as unknown as ModelWithConfigHeaders;
		const raw = model.config?.headers?.() ?? {};
		// Header names are case-insensitive and the compatible SDK lowercases them, so normalize before asserting.
		return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
	}

	it('attaches attribution headers when the host is openrouter.ai', async () => {
		const headers = await requestHeaders(compatConfig({ baseURL: 'https://openrouter.ai/api/v1' }));
		expect(headers['x-openrouter-title']).toBe('Hiyori App');
		expect(headers['http-referer']).toBe('https://kazenorin.github.io/hiyori-app');
		expect(headers['x-openrouter-categories']).toBe('roleplay,creative-writing');
	});

	it('sends no attribution headers for a third-party compatible host', async () => {
		const headers = await requestHeaders(compatConfig({ baseURL: 'https://api.example.com/v1' }));
		expect(headers['x-openrouter-title']).toBeUndefined();
		expect(headers['http-referer']).toBeUndefined();
		expect(headers['x-openrouter-categories']).toBeUndefined();
	});
});
