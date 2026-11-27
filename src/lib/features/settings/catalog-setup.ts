import { resolveModelWiring } from '#lib/ai/catalog/eligibility.ts';
import type { CatalogModelEntry, EligibleModel, EligibleProvider, ModelSnapshot } from '#lib/ai/catalog/types.ts';
import type { ProviderCallSettings } from '#lib/stores/settings.svelte.ts';

export interface EntryDraft {
	callSettings?: ProviderCallSettings;
	reasoningToggle?: 'on' | 'off';
	reasoningBudget?: number;
}

export interface SelectorModelRow {
	modelId: string;
	snapshot: ModelSnapshot;
	providerType: CatalogModelEntry['providerType'];
	isOrphan: boolean;
}

export function toModelSnapshot(model: EligibleModel): ModelSnapshot {
	return {
		name: model.name,
		reasoning: model.reasoning,
		tool_call: model.tool_call,
		attachment: model.attachment,
		context: model.context,
		...(model.status ? { status: model.status } : {}),
		...(model.reasoning_options ? { reasoning_options: model.reasoning_options } : {}),
		...(model.temperature !== undefined ? { temperature: model.temperature } : {}),
	};
}

/**
 * Selector visibility (design §6.1/§6.2): current non-deprecated models, deprecated models already
 * enabled when the page opened, and enabled models missing from the current catalog. Orphans stay
 * visible regardless of the live list or whether they were unchecked during the session.
 */
export function buildSelectorRows(params: {
	provider: EligibleProvider | null;
	liveModels: EligibleModel[];
	enabledEntries: CatalogModelEntry[];
	query?: string;
}): SelectorModelRow[] {
	const liveById = new Map(params.liveModels.map((model) => [model.id, model]));
	const pinned = new Set(
		params.enabledEntries
			.filter((entry) => entry.snapshot.status === 'deprecated' || liveById.get(entry.modelId)?.status === 'deprecated')
			.map((entry) => entry.modelId)
	);

	const rows: SelectorModelRow[] = [];
	for (const model of params.liveModels) {
		if (model.status === 'deprecated' && !pinned.has(model.id)) continue;
		rows.push({
			modelId: model.id,
			snapshot: toModelSnapshot(model),
			providerType: params.provider ? resolveModelWiring(params.provider, model).providerType : 'openai-compatible',
			isOrphan: false,
		});
	}
	for (const entry of params.enabledEntries) {
		if (liveById.has(entry.modelId)) continue;
		rows.push({ modelId: entry.modelId, snapshot: entry.snapshot, providerType: entry.providerType, isOrphan: true });
	}

	const query = params.query?.trim().toLowerCase() ?? '';
	const filtered = query
		? rows.filter((row) => row.snapshot.name.toLowerCase().includes(query) || row.modelId.toLowerCase().includes(query))
		: rows;
	return filtered.sort((a, b) => a.snapshot.name.localeCompare(b.snapshot.name) || a.modelId.localeCompare(b.modelId));
}

/**
 * Projects the page selection into persisted entries. Kept entries retain their id and settings,
 * refreshing their snapshot from the live catalog when available; newly selected live models get
 * wiring resolved at save time and a fresh id.
 */
export function projectCatalogEntries(params: {
	provider: EligibleProvider | null;
	liveModels: EligibleModel[];
	existingEntries: CatalogModelEntry[];
	selectedIds: ReadonlySet<string>;
	drafts: ReadonlyMap<string, EntryDraft>;
	newId: () => string;
}): CatalogModelEntry[] {
	const liveById = new Map(params.liveModels.map((model) => [model.id, model]));
	const handled = new Set<string>();
	const entries: CatalogModelEntry[] = [];

	for (const existing of params.existingEntries) {
		if (!params.selectedIds.has(existing.modelId) || handled.has(existing.modelId)) continue;
		handled.add(existing.modelId);
		const live = liveById.get(existing.modelId);
		const draft = params.drafts.get(existing.modelId);
		entries.push({
			...existing,
			...(live ? { snapshot: toModelSnapshot(live) } : {}),
			callSettings: draft ? draft.callSettings : existing.callSettings,
			reasoningToggle: draft ? draft.reasoningToggle : existing.reasoningToggle,
			reasoningBudget: draft ? draft.reasoningBudget : existing.reasoningBudget,
		});
	}

	if (params.provider) {
		for (const model of params.liveModels) {
			if (!params.selectedIds.has(model.id) || handled.has(model.id)) continue;
			handled.add(model.id);
			const draft = params.drafts.get(model.id);
			entries.push({
				id: params.newId(),
				modelId: model.id,
				...resolveModelWiring(params.provider, model),
				snapshot: toModelSnapshot(model),
				callSettings: draft?.callSettings,
				reasoningToggle: draft?.reasoningToggle,
				reasoningBudget: draft?.reasoningBudget,
			});
		}
	}

	return entries;
}

export function removedEntryIds(existingEntries: CatalogModelEntry[], nextEntries: CatalogModelEntry[]): string[] {
	const kept = new Set(nextEntries.map((entry) => entry.id));
	return existingEntries.filter((entry) => !kept.has(entry.id)).map((entry) => entry.id);
}
