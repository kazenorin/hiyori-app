import { describe, it, expect } from 'vitest';
import type { CatalogModelEntry, EligibleModel, EligibleProvider } from '#lib/ai/catalog/types.ts';
import { buildSelectorRows, projectCatalogEntries, removedEntryIds, toModelSnapshot } from './catalog-setup';

const provider: EligibleProvider = {
	id: 'acme',
	name: 'Acme',
	npm: '@ai-sdk/openai-compatible',
	api: 'https://api.acme.test/v1',
	env: [],
	doc: '',
	models: [],
};

function model(overrides: Partial<EligibleModel> & Pick<EligibleModel, 'id' | 'name'>): EligibleModel {
	return {
		reasoning: false,
		tool_call: false,
		attachment: false,
		release_date: '2026-01-01',
		context: 32768,
		...overrides,
	};
}

const liveModels: EligibleModel[] = [
	model({ id: 'acme/current', name: 'Current' }),
	model({ id: 'acme/retired', name: 'Retired', status: 'deprecated' }),
	model({ id: 'acme/beta', name: 'Beta', status: 'beta', reasoning: true }),
];

function entry(overrides: Partial<CatalogModelEntry> & Pick<CatalogModelEntry, 'id' | 'modelId'>): CatalogModelEntry {
	return {
		providerType: 'openai-compatible',
		apiType: 'chat-completions',
		snapshot: { name: overrides.modelId, reasoning: false, tool_call: false, attachment: false, context: 8192 },
		...overrides,
	};
}

const existingEntries: CatalogModelEntry[] = [
	entry({
		id: 'e1',
		modelId: 'acme/current',
		snapshot: { name: 'Stale Current', reasoning: false, tool_call: false, attachment: false, context: 8192 },
	}),
	entry({
		id: 'e2',
		modelId: 'acme/retired',
		snapshot: { name: 'Retired', reasoning: false, tool_call: false, attachment: false, context: 8192, status: 'deprecated' },
	}),
	entry({
		id: 'e3',
		modelId: 'acme/gone',
		snapshot: { name: 'Gone', reasoning: false, tool_call: false, attachment: false, context: 4096 },
	}),
];

describe('toModelSnapshot', () => {
	it('copies only the metadata needed for display and constraints', () => {
		const snapshot = toModelSnapshot(
			model({ id: 'm', name: 'M', status: 'beta', reasoning: true, reasoning_options: [{ type: 'toggle' }], temperature: false })
		);
		expect(snapshot).toEqual({
			name: 'M',
			reasoning: true,
			tool_call: false,
			attachment: false,
			context: 32768,
			status: 'beta',
			reasoning_options: [{ type: 'toggle' }],
			temperature: false,
		});
	});
});

describe('buildSelectorRows', () => {
	it('add mode never lists deprecated models', () => {
		const rows = buildSelectorRows({ provider, liveModels, enabledEntries: [] });
		expect(rows.map((row) => row.modelId)).toEqual(['acme/beta', 'acme/current']);
	});

	it('edit mode keeps an enabled deprecated model visible, and keeps it pinned after it is unchecked', () => {
		const rows = buildSelectorRows({ provider, liveModels, enabledEntries: existingEntries });
		// Visibility depends on the mount snapshot (enabledEntries), not the live checked set.
		expect(rows.map((row) => row.modelId)).toContain('acme/retired');
	});

	it('treats an enabled model that became deprecated upstream as pinned', () => {
		// The saved snapshot predates the deprecation; the live status still keeps it visible.
		const stale = entry({
			id: 'e4',
			modelId: 'acme/retired',
			snapshot: { name: 'Retired', reasoning: false, tool_call: false, attachment: false, context: 8192 },
		});
		const rows = buildSelectorRows({ provider, liveModels, enabledEntries: [stale] });
		expect(rows.find((row) => row.modelId === 'acme/retired')).toMatchObject({ isOrphan: false, snapshot: { status: 'deprecated' } });
	});

	it('lists enabled models missing from the catalog as orphans', () => {
		const rows = buildSelectorRows({ provider, liveModels, enabledEntries: existingEntries });
		const orphan = rows.find((row) => row.modelId === 'acme/gone');
		expect(orphan).toMatchObject({ isOrphan: true, snapshot: { name: 'Gone' } });
		// The live catalog wins over the saved snapshot for listed models.
		expect(rows.find((row) => row.modelId === 'acme/current')?.snapshot.name).toBe('Current');
	});

	it('lists every enabled entry as an orphan when the catalog is unavailable', () => {
		const rows = buildSelectorRows({ provider: null, liveModels: [], enabledEntries: existingEntries });
		expect(rows).toHaveLength(3);
		expect(rows.every((row) => row.isOrphan)).toBe(true);
	});

	it('matches search against name and id', () => {
		expect(buildSelectorRows({ provider, liveModels, enabledEntries: [], query: 'bet' }).map((row) => row.modelId)).toEqual(['acme/beta']);
		expect(buildSelectorRows({ provider, liveModels, enabledEntries: [], query: 'acme/current' }).map((row) => row.modelId)).toEqual([
			'acme/current',
		]);
	});
});

describe('projectCatalogEntries', () => {
	it('keeps entry ids and settings, refreshes snapshots, and appends newly selected models with fresh ids', () => {
		const callSettings = { temperature: 0.2 };
		const withSettings = existingEntries.map((item) => (item.id === 'e1' ? { ...item, callSettings } : item));
		let counter = 0;
		const entries = projectCatalogEntries({
			provider,
			liveModels,
			existingEntries: withSettings,
			selectedIds: new Set(['acme/current', 'acme/retired', 'acme/gone', 'acme/beta']),
			drafts: new Map([['acme/current', { callSettings: { temperature: 0.9 } }]]),
			newId: () => `new-${++counter}`,
		});

		expect(entries.map((item) => item.modelId)).toEqual(['acme/current', 'acme/retired', 'acme/gone', 'acme/beta']);
		const current = entries[0];
		expect(current.id).toBe('e1');
		expect(current.callSettings).toEqual({ temperature: 0.9 });
		expect(current.snapshot.name).toBe('Current');
		const retired = entries[1];
		expect(retired.id).toBe('e2');
		expect(retired.snapshot.status).toBe('deprecated');
		const gone = entries[2];
		expect(gone.id).toBe('e3');
		expect(gone.snapshot.name).toBe('Gone');
		const fresh = entries[3];
		expect(fresh.id).toBe('new-1');
		expect(fresh.modelId).toBe('acme/beta');
		expect(fresh.snapshot).toMatchObject({ name: 'Beta', status: 'beta' });
	});

	it('drops unchecked entries and reports their ids for role cleanup', () => {
		const entries = projectCatalogEntries({
			provider,
			liveModels,
			existingEntries,
			selectedIds: new Set(['acme/current', 'acme/gone']),
			drafts: new Map(),
			newId: () => 'unused',
		});
		expect(entries.map((item) => item.modelId)).toEqual(['acme/current', 'acme/gone']);
		expect(removedEntryIds(existingEntries, entries)).toEqual(['e2']);
	});

	it('offline (no provider) preserves enabled entries without fabricating new ones', () => {
		const entries = projectCatalogEntries({
			provider: null,
			liveModels: [],
			existingEntries,
			selectedIds: new Set(['acme/current', 'acme/retired', 'acme/gone']),
			drafts: new Map(),
			newId: () => 'unused',
		});
		expect(entries.map((item) => item.id)).toEqual(['e1', 'e2', 'e3']);
		expect(entries.every((item) => item.providerType === 'openai-compatible')).toBe(true);
	});
});
