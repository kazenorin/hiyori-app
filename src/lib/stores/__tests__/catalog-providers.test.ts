import { beforeEach, describe, expect, it } from 'vitest';
import {
	addCatalogProvider,
	addProviderConfig,
	assignRole,
	cleanupRoleAssignments,
	deleteCatalogProvider,
	getProviderConfig,
	reorderCatalogProviders,
	settings,
	updateCatalogProvider,
} from '#lib/stores/settings.svelte.ts';
import type { CatalogModelEntry, CatalogProviderEntity } from '#lib/ai/catalog/types.ts';

const ENTRY_ID = 'entry-siliconflow-deepseek';

function makeEntry(overrides: Partial<CatalogModelEntry> = {}): CatalogModelEntry {
	return {
		id: ENTRY_ID,
		modelId: 'deepseek-ai/DeepSeek-V3',
		providerType: 'openai-compatible',
		apiType: 'chat-completions',
		snapshot: { name: 'DeepSeek V3', reasoning: false, tool_call: true, attachment: false, context: 65536 },
		...overrides,
	};
}

function openRouterEntry(overrides: Partial<CatalogModelEntry> = {}): CatalogModelEntry {
	return makeEntry({
		id: 'entry-openrouter-o3',
		modelId: 'openai/o3',
		providerType: 'openrouter',
		apiType: 'chat-completions',
		snapshot: { name: 'o3', reasoning: true, tool_call: true, attachment: false, context: 200000 },
		...overrides,
	});
}

function makeEntity(overrides: Partial<Omit<CatalogProviderEntity, 'id'>> = {}): Omit<CatalogProviderEntity, 'id'> {
	return {
		catalogId: 'siliconflow',
		displayName: 'SiliconFlow',
		apiKey: 'sk-catalog',
		baseURL: 'https://api.siliconflow.cn/v1',
		corsBypassEnabled: true,
		wispProxyUrl: 'ws://localhost:6001',
		enabledModels: [makeEntry()],
		...overrides,
	};
}

function makeCustomProvider(name = 'Custom'): string {
	return addProviderConfig({
		name,
		provider: 'openai',
		apiType: 'responses',
		baseURL: 'https://api.openai.com/v1',
		model: 'gpt-5',
		apiKey: 'sk-custom',
		corsBypassEnabled: false,
		wispProxyUrl: 'ws://localhost:6001',
	}).id;
}

// The store is module-level state persisted to localStorage; isolate each test
// by resetting the collections this suite mutates.
beforeEach(() => {
	settings.providers = [];
	settings.catalogProviders = [];
	settings.roleAssignments = {};
	settings.roleCallSettings = {};
});

describe('getProviderConfig cross-store resolution', () => {
	it('resolves a custom provider', () => {
		const id = makeCustomProvider('OpenAI');
		expect(getProviderConfig(id)?.name).toBe('OpenAI');
	});

	it('resolves and materializes a catalog entry', () => {
		addCatalogProvider(makeEntity());
		expect(getProviderConfig(ENTRY_ID)?.name).toBe('SiliconFlow · DeepSeek V3');
	});

	it('returns undefined for an unknown id', () => {
		expect(getProviderConfig('missing-id')).toBeUndefined();
	});

	it('prefers a custom provider when ids collide', () => {
		const customId = makeCustomProvider('Custom Wins');
		addCatalogProvider(makeEntity({ enabledModels: [makeEntry({ id: customId })] }));

		expect(getProviderConfig(customId)?.name).toBe('Custom Wins');
	});
});

describe('catalog entry materialization', () => {
	it('produces a ProviderConfig from the entity and entry', () => {
		addCatalogProvider(makeEntity());

		expect(getProviderConfig(ENTRY_ID)).toEqual({
			id: ENTRY_ID,
			name: 'SiliconFlow · DeepSeek V3',
			provider: 'openai-compatible',
			apiType: 'chat-completions',
			baseURL: 'https://api.siliconflow.cn/v1',
			model: 'deepseek-ai/DeepSeek-V3',
			apiKey: 'sk-catalog',
			corsBypassEnabled: true,
			wispProxyUrl: 'ws://localhost:6001',
			callSettings: {},
		});
	});

	it('lets a per-model baseURL override the entity baseURL', () => {
		addCatalogProvider(makeEntity({ enabledModels: [makeEntry({ baseURL: 'https://models.example.com/v1' })] }));

		expect(getProviderConfig(ENTRY_ID)?.baseURL).toBe('https://models.example.com/v1');
	});

	it('keeps the entry callSettings', () => {
		addCatalogProvider(makeEntity({ enabledModels: [makeEntry({ callSettings: { temperature: 0.3 } })] }));

		expect(getProviderConfig(ENTRY_ID)?.callSettings).toEqual({ temperature: 0.3 });
	});

	it('maps an OpenRouter toggle-off to providerOptions.openrouter.reasoning', () => {
		addCatalogProvider(makeEntity({ enabledModels: [openRouterEntry({ reasoningToggle: 'off' })] }));

		expect(getProviderConfig('entry-openrouter-o3')?.callSettings?.providerOptions).toEqual({
			openrouter: { reasoning: { enabled: false } },
		});
	});

	it('maps an OpenRouter toggle-on plus budget to enabled reasoning with max_tokens', () => {
		addCatalogProvider(makeEntity({ enabledModels: [openRouterEntry({ reasoningToggle: 'on', reasoningBudget: 4096 })] }));

		expect(getProviderConfig('entry-openrouter-o3')?.callSettings?.providerOptions).toEqual({
			openrouter: { reasoning: { enabled: true, max_tokens: 4096 } },
		});
	});

	it('maps an OpenRouter budget alone to max_tokens reasoning', () => {
		addCatalogProvider(makeEntity({ enabledModels: [openRouterEntry({ reasoningBudget: 2048 })] }));

		expect(getProviderConfig('entry-openrouter-o3')?.callSettings?.providerOptions).toEqual({
			openrouter: { reasoning: { max_tokens: 2048 } },
		});
	});

	it('merges reasoning into existing callSettings and providerOptions', () => {
		addCatalogProvider(
			makeEntity({
				enabledModels: [
					openRouterEntry({
						reasoningToggle: 'on',
						callSettings: { temperature: 0.2, providerOptions: { openrouter: { transforms: ['middle-out'] } } },
					}),
				],
			})
		);

		const callSettings = getProviderConfig('entry-openrouter-o3')?.callSettings;
		expect(callSettings?.temperature).toBe(0.2);
		expect(callSettings?.providerOptions).toEqual({
			openrouter: { transforms: ['middle-out'], reasoning: { enabled: true } },
		});
	});

	it('does not emit reasoning providerOptions for non-OpenRouter entries', () => {
		addCatalogProvider(
			makeEntity({
				enabledModels: [makeEntry({ reasoningToggle: 'on', reasoningBudget: 8192 })],
			})
		);

		const callSettings = getProviderConfig(ENTRY_ID)?.callSettings;
		expect(callSettings).toEqual({});
		expect(callSettings?.providerOptions).toBeUndefined();
	});
});

describe('catalog provider CRUD', () => {
	it('appends the entity and assigns main to its first entry when unset', () => {
		const created = addCatalogProvider(makeEntity());

		expect(created.id).toBeTruthy();
		expect(created.id).not.toBe(ENTRY_ID);
		expect(settings.catalogProviders).toHaveLength(1);
		expect(settings.catalogProviders[0].catalogId).toBe('siliconflow');
		expect(settings.roleAssignments['main']).toBe(ENTRY_ID);
	});

	it('keeps an existing main assignment', () => {
		const customId = makeCustomProvider();
		assignRole('main', customId);

		addCatalogProvider(makeEntity());

		expect(settings.roleAssignments['main']).toBe(customId);
	});

	it('merges the partial into the entity while keeping untouched fields', () => {
		const created = addCatalogProvider(makeEntity());
		const secondEntry = makeEntry({
			id: 'entry-second',
			modelId: 'Qwen/Qwen3-235B',
			snapshot: { name: 'Qwen3 235B', reasoning: false, tool_call: true, attachment: false, context: 131072 },
		});

		updateCatalogProvider(created.id, { displayName: 'My SiliconFlow', enabledModels: [makeEntry(), secondEntry] });

		const entity = settings.catalogProviders[0];
		expect(entity.displayName).toBe('My SiliconFlow');
		expect(entity.catalogId).toBe('siliconflow');
		expect(entity.enabledModels.map((m) => m.id)).toEqual([ENTRY_ID, 'entry-second']);
	});

	it('deleteCatalogProvider removes the entity and clears role assignments for its entry ids', () => {
		const entity = addCatalogProvider(makeEntity({ enabledModels: [makeEntry(), makeEntry({ id: 'entry-two' })] }));
		const customId = makeCustomProvider();
		assignRole('writer', 'entry-two');
		assignRole('reviewer', customId);

		deleteCatalogProvider(entity.id);

		expect(settings.catalogProviders).toHaveLength(0);
		expect(settings.roleAssignments).toEqual({ reviewer: customId });
		expect(getProviderConfig(ENTRY_ID)).toBeUndefined();
	});

	it('cleanupRoleAssignments removes only the given ids', () => {
		const customId = makeCustomProvider();
		assignRole('main', customId);
		assignRole('writer', 'entry-a');
		assignRole('editor', 'entry-b');

		cleanupRoleAssignments(['entry-a']);

		expect(settings.roleAssignments).toEqual({ main: customId, editor: 'entry-b' });
	});

	it('reorders catalog entities by the given ids and persists', () => {
		const a = addCatalogProvider(makeEntity({ catalogId: 'a', displayName: 'A' }));
		const b = addCatalogProvider(makeEntity({ catalogId: 'b', displayName: 'B' }));
		const c = addCatalogProvider(makeEntity({ catalogId: 'c', displayName: 'C' }));

		reorderCatalogProviders([c.id, a.id, b.id]);

		expect(settings.catalogProviders.map((e) => e.id)).toEqual([c.id, a.id, b.id]);
		const stored = JSON.parse(localStorage.getItem('hiyori-settings')!);
		expect(stored.catalogProviders.map((e: { id: string }) => e.id)).toEqual([c.id, a.id, b.id]);
	});

	it('keeps unlisted catalog entities at the end in their relative order', () => {
		const a = addCatalogProvider(makeEntity({ catalogId: 'a', displayName: 'A' }));
		const b = addCatalogProvider(makeEntity({ catalogId: 'b', displayName: 'B' }));
		const c = addCatalogProvider(makeEntity({ catalogId: 'c', displayName: 'C' }));

		reorderCatalogProviders([c.id]);

		expect(settings.catalogProviders.map((e) => e.id)).toEqual([c.id, a.id, b.id]);
	});
});
