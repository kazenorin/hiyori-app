import { constraintsFromSnapshot, type CatalogConstraints } from '#lib/ai/catalog/effort.ts';
import type { CatalogModelEntry } from '#lib/ai/catalog/types.ts';
import {
	getEditorProviderConfig,
	getEmbeddingProviderConfig,
	getGameMasterProviderConfig,
	getMainProviderConfig,
	getMemoryProviderConfig,
	getMinorTaskAgentProviderConfig,
	getPlotPlannerProviderConfig,
	getReviewerProviderConfig,
	getSummarizerProviderConfig,
	getWriterProviderConfig,
	settings,
	type ProviderConfig,
} from '#lib/stores/settings.svelte.ts';

/**
 * Role key → the store resolver the pipeline uses for that role. Delegating to the resolvers keeps
 * role-level constraints on exactly the same fallback path as execution (assignment → 'main').
 */
const ROLE_CONFIG_RESOLVERS: Record<string, () => ProviderConfig | undefined> = {
	main: getMainProviderConfig,
	memory: getMemoryProviderConfig,
	embedding: getEmbeddingProviderConfig,
	minorTaskAgent: getMinorTaskAgentProviderConfig,
	plotPlanner: getPlotPlannerProviderConfig,
	reviewer: getReviewerProviderConfig,
	writer: getWriterProviderConfig,
	editor: getEditorProviderConfig,
	gameMaster: getGameMasterProviderConfig,
	summarizer: getSummarizerProviderConfig,
};

function catalogEntryById(id: string): CatalogModelEntry | undefined {
	// A custom provider with the same id shadows the catalog entry, mirroring getProviderConfig().
	if (settings.providers.some((provider) => provider.id === id)) return undefined;
	for (const entity of settings.catalogProviders) {
		const entry = entity.enabledModels.find((model) => model.id === id);
		if (entry) return entry;
	}
	return undefined;
}

/** The catalog entry a role currently resolves to, if any. */
function roleCatalogEntry(role: string): CatalogModelEntry | undefined {
	const config = ROLE_CONFIG_RESOLVERS[role]?.();
	return config ? catalogEntryById(config.id) : undefined;
}

/**
 * Catalog constraints for a role's Advanced Settings override. Role overrides persist
 * `LanguageModelCallOptions` only — there is no storage for toggle/budget transport — so those
 * controls are always hidden here even when the catalog model offers them.
 */
export function roleCatalogConstraints(role: string): CatalogConstraints | undefined {
	const entry = roleCatalogEntry(role);
	if (!entry) return undefined;
	return { ...constraintsFromSnapshot(entry.snapshot, entry.providerType), hasToggle: false, hasBudget: false };
}

/**
 * Delete guard for catalog provider groups: deleting a group also removes its model entries, and the
 * main role has no fallback, so the group holding the main-role entry cannot be deleted.
 */
export function isMainRoleEntry(entryIds: readonly string[]): boolean {
	const mainId = settings.roleAssignments['main'];
	return mainId !== undefined && entryIds.includes(mainId);
}

/**
 * Edit-save counterpart to the delete guard: when the main-assigned entry is unchecked, the first
 * remaining entry takes over, because main has no fallback and must never be silently orphaned.
 */
export function reassignMainRole(currentMainId: string | undefined, removedIds: string[], remainingEntryIds: string[]): string | undefined {
	if (currentMainId === undefined || !removedIds.includes(currentMainId) || remainingEntryIds.length === 0) return undefined;
	return remainingEntryIds[0];
}
