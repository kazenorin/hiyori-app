import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CatalogModelEntry } from '#lib/ai/catalog/types.ts';
import { loadLocale } from '#lib/i18n/index.ts';
import { addCatalogProvider, addProviderConfig, settings } from '#lib/stores/settings.svelte.ts';
import { getRoleItems } from './settings-options.ts';

function entry(id: string, name: string): CatalogModelEntry {
	return {
		id,
		modelId: `siliconflow/${id}`,
		providerType: 'openai-compatible',
		apiType: 'chat-completions',
		snapshot: { name, reasoning: false, tool_call: true, attachment: false, context: 65536 },
	};
}

function addCustomProvider(name: string): string {
	return addProviderConfig({
		name,
		provider: 'openai',
		apiType: 'chat-completions',
		baseURL: 'https://api.example.com/v1',
		model: 'custom-model',
		apiKey: 'sk-custom',
		corsBypassEnabled: false,
		wispProxyUrl: 'ws://localhost:6001',
	}).id;
}

beforeAll(async () => {
	await loadLocale('en');
});

beforeEach(() => {
	settings.providers = [];
	settings.catalogProviders = [];
	settings.roleAssignments = {};
});

describe('getRoleItems', () => {
	it('lists catalog entries before custom models, labeled "Provider · Model" with the entry id as value', () => {
		addCatalogProvider({
			catalogId: 'siliconflow',
			displayName: 'SiliconFlow',
			baseURL: 'https://api.siliconflow.cn/v1',
			corsBypassEnabled: false,
			wispProxyUrl: 'ws://localhost:6001',
			enabledModels: [entry('entry-deepseek', 'DeepSeek V3'), entry('entry-qwen', 'Qwen3 235B')],
		});
		const customId = addCustomProvider('My Custom');

		const items = getRoleItems();

		expect(items.map((item) => item.value)).toEqual(['main', 'entry-deepseek', 'entry-qwen', customId]);
		expect(items[0].label).toBe('Main Provider');
		expect(items[1].label).toBe('SiliconFlow · DeepSeek V3');
		expect(items[2].label).toBe('SiliconFlow · Qwen3 235B');
		expect(items[3].label).toBe('My Custom');
	});

	it('omits only the "main" sentinel when includeMain is false', () => {
		addCatalogProvider({
			catalogId: 'siliconflow',
			displayName: 'SiliconFlow',
			baseURL: 'https://api.siliconflow.cn/v1',
			corsBypassEnabled: false,
			wispProxyUrl: 'ws://localhost:6001',
			enabledModels: [entry('entry-deepseek', 'DeepSeek V3')],
		});
		addCustomProvider('My Custom');

		expect(getRoleItems(false)).toEqual(getRoleItems().filter((item) => item.value !== 'main'));
		expect(getRoleItems(false).some((item) => item.value === 'main')).toBe(false);
	});
});
