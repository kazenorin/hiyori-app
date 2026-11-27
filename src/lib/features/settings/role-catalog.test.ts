import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalogModelEntry, CatalogProviderEntity } from '#lib/ai/catalog/types.ts';
import {
	addCatalogProvider,
	addProviderConfig,
	assignRole,
	cleanupRoleAssignments,
	deleteCatalogProvider,
	getMainProviderConfig,
	getProviderConfig,
	getWriterProviderConfig,
	setRoleCallSettings,
	settings,
	updateCatalogProvider,
} from '#lib/stores/settings.svelte.ts';
import { removedEntryIds } from './catalog-setup.ts';
import { isMainRoleEntry, reassignMainRole, roleCatalogConstraints } from './role-catalog.ts';

const CATALOG_ENTRY_ID = 'entry-gpt-oss';

/** Pipeline role key → the setting that decides whether the role reads its own assignment or 'main'. */
const PIPELINE_ROLE_MODES = [
	['memory', 'memoryProviderRole'],
	['embedding', 'embeddingProviderRole'],
	['minorTaskAgent', 'minorTaskAgentProviderRole'],
	['plotPlanner', 'plotPlannerProviderRole'],
	['reviewer', 'reviewerProviderRole'],
	['writer', 'writerProviderRole'],
	['editor', 'editorProviderRole'],
	['gameMaster', 'gameMasterProviderRole'],
	['summarizer', 'summarizerProviderRole'],
] as const;

function constrainedEntry(overrides: Partial<CatalogModelEntry> = {}): CatalogModelEntry {
	return {
		id: CATALOG_ENTRY_ID,
		modelId: 'openai/gpt-oss-120b',
		providerType: 'openrouter',
		apiType: 'chat-completions',
		snapshot: {
			name: 'GPT OSS 120B',
			reasoning: true,
			tool_call: true,
			attachment: false,
			context: 131072,
			reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }, { type: 'toggle' }, { type: 'budget_tokens', min: 1024 }],
			temperature: false,
		},
		...overrides,
	};
}

function entity(enabledModels: CatalogModelEntry[] = [constrainedEntry()]): Omit<CatalogProviderEntity, 'id'> {
	return {
		catalogId: 'openrouter',
		displayName: 'OpenRouter',
		apiKey: 'sk-or',
		baseURL: 'https://openrouter.ai/api/v1',
		corsBypassEnabled: false,
		wispProxyUrl: 'ws://localhost:6001',
		enabledModels,
	};
}

function addCustomProvider(): string {
	return addProviderConfig({
		name: 'Custom GPT',
		provider: 'openai',
		apiType: 'responses',
		baseURL: 'https://api.openai.com/v1',
		model: 'gpt-5',
		apiKey: 'sk-custom',
		corsBypassEnabled: false,
		wispProxyUrl: 'ws://localhost:6001',
	}).id;
}

beforeEach(() => {
	settings.providers = [];
	settings.catalogProviders = [];
	settings.roleAssignments = {};
	settings.roleCallSettings = {};
	for (const [, modeField] of PIPELINE_ROLE_MODES) settings[modeField] = 'main';
});

describe('roleCatalogConstraints', () => {
	it('constrains effort and temperature for a catalog entry assigned to a role', () => {
		addCatalogProvider(entity());
		assignRole('writer', CATALOG_ENTRY_ID);
		settings.writerProviderRole = 'writer';

		const constraints = roleCatalogConstraints('writer');

		expect(constraints).toMatchObject({
			effortValues: ['provider-default', 'low', 'medium', 'high'],
			temperatureSupported: false,
			providerType: 'openrouter',
		});
	});

	it('hides toggle and budget for role overrides, which cannot store that transport', () => {
		addCatalogProvider(entity());
		assignRole('writer', CATALOG_ENTRY_ID);
		settings.writerProviderRole = 'writer';

		const constraints = roleCatalogConstraints('writer');

		// The snapshot offers both; the role-override editor must still not render them.
		expect(constraints?.hasToggle).toBe(false);
		expect(constraints?.hasBudget).toBe(false);
	});

	it('returns no constraints for a custom provider', () => {
		const customId = addCustomProvider();
		assignRole('writer', customId);
		settings.writerProviderRole = 'writer';

		expect(roleCatalogConstraints('writer')).toBeUndefined();
	});

	it('resolves an unassigned role through the main assignment, like the pipeline', () => {
		addCatalogProvider(entity());
		assignRole('main', CATALOG_ENTRY_ID);

		expect(settings.writerProviderRole).toBe('main');
		expect(roleCatalogConstraints('writer')?.effortValues).toEqual(['provider-default', 'low', 'medium', 'high']);
	});

	it('resolves a pipeline role pointing directly at a catalog entry', () => {
		addCatalogProvider(entity());
		settings.writerProviderRole = CATALOG_ENTRY_ID;

		expect(roleCatalogConstraints('writer')?.providerType).toBe('openrouter');
	});

	it('returns no constraints when the assigned entry was deleted', () => {
		const created = addCatalogProvider(entity());
		assignRole('writer', CATALOG_ENTRY_ID);
		settings.writerProviderRole = 'writer';
		deleteCatalogProvider(created.id);

		expect(roleCatalogConstraints('writer')).toBeUndefined();
	});

	it('returns no constraints for an unknown role', () => {
		addCatalogProvider(entity());
		assignRole('main', CATALOG_ENTRY_ID);

		expect(roleCatalogConstraints('not-a-role')).toBeUndefined();
	});

	it('does not let a custom provider shadowing the entry id yield catalog constraints for main', () => {
		const customId = addCustomProvider();
		addCatalogProvider(entity([constrainedEntry({ id: customId })]));
		assignRole('main', customId);

		// The assigned id exists as a catalog entry, so only the custom-shadow guard can make this undefined.
		expect(roleCatalogConstraints('main')).toBeUndefined();
	});
});

describe('role dispatch does not collapse to the main config', () => {
	it.each(PIPELINE_ROLE_MODES)(
		'resolves %s constraints from its own custom-provider assignment, not the catalog-backed main',
		(role, modeField) => {
			const customId = addCustomProvider();
			addCatalogProvider(entity());
			assignRole(role, customId);
			settings[modeField] = role;

			expect(roleCatalogConstraints('main')).toBeDefined();
			expect(roleCatalogConstraints(role)).toBeUndefined();
		}
	);
});

describe('role catalog resolution end to end', () => {
	it('resolves a role through the store, applies the role override, and cleans up on delete', () => {
		const customId = addCustomProvider();
		const created = addCatalogProvider(entity());
		assignRole('main', customId);
		assignRole('writer', CATALOG_ENTRY_ID);
		settings.writerProviderRole = 'writer';

		expect(getProviderConfig(CATALOG_ENTRY_ID)?.model).toBe('openai/gpt-oss-120b');
		expect(roleCatalogConstraints('main')).toBeUndefined();
		expect(getWriterProviderConfig()?.provider).toBe('openrouter');

		setRoleCallSettings('writer', { temperature: 0.3 });
		expect(getWriterProviderConfig()?.callSettings?.temperature).toBe(0.3);
		expect(roleCatalogConstraints('writer')).toBeDefined();

		deleteCatalogProvider(created.id);

		expect(settings.roleAssignments['writer']).toBeUndefined();
		expect(getWriterProviderConfig()).toBeUndefined();
		expect(roleCatalogConstraints('writer')).toBeUndefined();
	});
});

describe('isMainRoleEntry', () => {
	it('reports true when the main role is assigned to one of the entry ids', () => {
		addCatalogProvider(entity([constrainedEntry({ id: 'entry-a' }), constrainedEntry({ id: 'entry-b' })]));
		assignRole('main', 'entry-b');

		expect(isMainRoleEntry(['entry-a', 'entry-b'])).toBe(true);
	});

	it('reports false for a group whose entries are not the main role target', () => {
		addCatalogProvider(entity([constrainedEntry({ id: 'entry-a' })]));
		assignRole('main', 'entry-other');

		expect(isMainRoleEntry(['entry-a'])).toBe(false);
	});

	it('reports false when no main role is assigned', () => {
		expect(isMainRoleEntry(['entry-a'])).toBe(false);
	});
});

describe('reassignMainRole', () => {
	it('hands main to the first remaining entry when the main-assigned entry is removed', () => {
		// Main has no fallback; edit-save must reassign rather than leave every role unresolvable.
		expect(reassignMainRole('entry-a', ['entry-a'], ['entry-b', 'entry-c'])).toBe('entry-b');
	});

	it('leaves main untouched when its entry survives the save', () => {
		expect(reassignMainRole('entry-a', ['entry-b'], ['entry-a', 'entry-c'])).toBeUndefined();
	});

	it('does not invent an assignment when no main role exists', () => {
		expect(reassignMainRole(undefined, ['entry-a'], ['entry-b'])).toBeUndefined();
	});

	it('cannot reassign when the save removes every entry', () => {
		expect(reassignMainRole('entry-a', ['entry-a'], [])).toBeUndefined();
	});

	it('edit-save sequence keeps main resolvable: capture before cleanup, reassign after', () => {
		const created = addCatalogProvider(entity([constrainedEntry({ id: 'entry-a' }), constrainedEntry({ id: 'entry-b' })]));
		assignRole('main', 'entry-a');
		const remaining = [constrainedEntry({ id: 'entry-b' })];
		const removed = removedEntryIds(created.enabledModels, remaining);
		const currentMain = settings.roleAssignments['main'];

		updateCatalogProvider(created.id, { enabledModels: remaining });
		cleanupRoleAssignments(removed);
		// Cleanup orphans main too — reading the assignment only after cleanup could never reassign it.
		expect(settings.roleAssignments['main']).toBeUndefined();

		const newMain = reassignMainRole(
			currentMain,
			removed,
			remaining.map((m) => m.id)
		);
		if (newMain) assignRole('main', newMain);

		expect(settings.roleAssignments['main']).toBe('entry-b');
		expect(getMainProviderConfig()?.id).toBe('entry-b');
	});
});
