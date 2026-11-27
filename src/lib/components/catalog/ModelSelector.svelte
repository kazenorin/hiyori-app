<script lang="ts">
	import { Search } from '@lucide/svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import type { LanguageModelCallOptions } from 'ai';
	import { t } from '#lib/i18n/index.ts';
	import type { CatalogModelEntry, EligibleModel, EligibleProvider } from '#lib/ai/catalog/types.ts';
	import { constraintsFromSnapshot } from '#lib/ai/catalog/effort.ts';
	import { buildSelectorRows, type EntryDraft } from '#lib/features/settings/catalog-setup.ts';
	import AdvancedSettingsEditor from '#lib/components/chat/AdvancedSettingsEditor.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import Modal from '#lib/components/ui/Modal.svelte';

	interface Props {
		provider: EligibleProvider | null;
		providerName: string;
		liveModels: EligibleModel[];
		existingEntries: CatalogModelEntry[];
		initialSelection: ReadonlySet<string>;
		initialDrafts: ReadonlyMap<string, EntryDraft>;
		focusModelId?: string | null;
		ondone: (result: { selectedIds: Set<string>; drafts: Map<string, EntryDraft> }) => void;
		oncancel: () => void;
	}

	let { provider, providerName, liveModels, existingEntries, initialSelection, initialDrafts, focusModelId, ondone, oncancel }: Props =
		$props();

	// Modal state is a session snapshot; the parent remounts the selector on every open.
	// svelte-ignore state_referenced_locally
	const selected = new SvelteSet<string>(initialSelection);
	// svelte-ignore state_referenced_locally
	const drafts = new SvelteMap<string, EntryDraft>([...initialDrafts].map(([modelId, draft]) => [modelId, { ...draft }] as const));
	let search = $state('');
	// svelte-ignore state_referenced_locally
	let expandedModelId = $state<string | null>(focusModelId ?? null);

	const rows = $derived(buildSelectorRows({ provider, liveModels, enabledEntries: existingEntries, query: search }));
	const selectedCount = $derived(selected.size);

	function toggle(modelId: string): void {
		if (selected.has(modelId)) selected.delete(modelId);
		else selected.add(modelId);
	}

	function selectAll(): void {
		for (const row of rows) selected.add(row.modelId);
	}

	function selectNone(): void {
		for (const row of rows) selected.delete(row.modelId);
	}

	function updateCallSettings(modelId: string, callSettings: LanguageModelCallOptions | undefined): void {
		drafts.set(modelId, { ...drafts.get(modelId), callSettings });
	}

	function updateReasoning(modelId: string, reasoning: { toggle?: 'on' | 'off'; budget?: number }): void {
		drafts.set(modelId, { ...drafts.get(modelId), reasoningToggle: reasoning.toggle, reasoningBudget: reasoning.budget });
	}

	function done(): void {
		ondone({ selectedIds: new Set(selected), drafts: new Map([...drafts].map(([modelId, draft]) => [modelId, { ...draft }])) });
	}

	function formatContext(tokens: number): string {
		if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`;
		return `${Math.round(tokens / 1000)}K`;
	}
</script>

<Modal open={true} title={t('settings.catalog.selectModelsTitle', { provider: providerName })} width="xl" onclose={oncancel}>
	{#snippet body()}
		<div class="flex flex-wrap items-center gap-2">
			<div class="relative min-w-0 flex-1">
				<Search size={16} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
				<input
					class="input pl-9"
					type="search"
					placeholder={t('settings.searchModels')}
					aria-label={t('settings.searchModels')}
					bind:value={search}
				/>
			</div>
			<Button size="sm" onclick={selectAll}>{t('settings.catalog.selectAll')}</Button>
			<Button size="sm" onclick={selectNone}>{t('settings.catalog.selectNone')}</Button>
		</div>

		<p class="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-surface-500">
			<span>{t('settings.catalog.nSelectedCount', { count: selectedCount })}</span>
			<span>·</span>
			<span>{t('settings.catalog.nShown', { count: rows.length })}</span>
			{#if existingEntries.some((entry) => entry.snapshot.status === 'deprecated')}
				<span class="text-warning-600-400">· {t('settings.catalog.deprecatedShown')}</span>
			{/if}
		</p>

		<div class="mt-3 max-h-[60vh] space-y-1.5 overflow-y-auto pr-1">
			{#if rows.length === 0}
				<p class="py-6 text-center text-sm text-surface-500">{t('settings.catalog.noMatchingModels')}</p>
			{:else}
				{#each rows as row, index (row.modelId)}
					<div class="overflow-hidden rounded-(--radius-base) border border-surface-200-800">
						<div class="flex items-start gap-2 p-2.5">
							<input
								id="catalog-model-{index}"
								type="checkbox"
								class="checkbox mt-1 shrink-0"
								checked={selected.has(row.modelId)}
								onchange={() => toggle(row.modelId)}
							/>
							<label for="catalog-model-{index}" class="min-w-0 flex-1 cursor-pointer">
								<span class="flex flex-wrap items-center gap-1.5">
									<span class="truncate text-sm font-medium">{row.snapshot.name}</span>
									{#if row.snapshot.reasoning}
										<span class="badge preset-tonal text-[10px]">{t('settings.catalog.capabilityReasoning')}</span>
									{/if}
									{#if row.snapshot.tool_call}
										<span class="badge preset-tonal text-[10px]">{t('settings.catalog.capabilityTools')}</span>
									{/if}
									{#if row.snapshot.attachment}
										<span class="badge preset-tonal text-[10px]">{t('settings.catalog.capabilityVision')}</span>
									{/if}
									{#if row.snapshot.status === 'alpha'}
										<span class="badge preset-tonal text-[10px] text-warning-600-400">{t('settings.catalog.statusAlpha')}</span>
									{:else if row.snapshot.status === 'beta'}
										<span class="badge preset-tonal text-[10px] text-warning-600-400">{t('settings.catalog.statusBeta')}</span>
									{:else if row.snapshot.status === 'deprecated'}
										<span class="badge preset-tonal text-[10px] text-warning-600-400">{t('settings.catalog.statusDeprecated')}</span>
									{/if}
									{#if row.isOrphan}
										<span class="badge preset-tonal text-[10px] text-error-700-300">{t('settings.catalog.noLongerListed')}</span>
									{/if}
								</span>
								<span class="mt-0.5 block truncate text-xs text-surface-500">
									{row.modelId} · {formatContext(row.snapshot.context)} ctx
								</span>
							</label>
							<button
								class="btn preset-ghost min-h-9 min-w-9 shrink-0 px-1.5"
								type="button"
								title={t('settings.catalog.advancedSettings')}
								aria-label={t('settings.catalog.advancedSettings')}
								onclick={() => (expandedModelId = expandedModelId === row.modelId ? null : row.modelId)}
							>
								<Icon name="cog" class="h-4 w-4 {expandedModelId === row.modelId ? 'text-primary-500' : ''}" />
							</button>
						</div>
						{#if expandedModelId === row.modelId}
							<div class="border-t border-surface-200-800 bg-surface-100-900 p-3">
								{#key row.modelId}
									<AdvancedSettingsEditor
										callSettings={drafts.get(row.modelId)?.callSettings}
										catalogConstraints={constraintsFromSnapshot(row.snapshot, row.providerType)}
										catalogReasoning={{
											toggle: drafts.get(row.modelId)?.reasoningToggle,
											budget: drafts.get(row.modelId)?.reasoningBudget,
										}}
										onValueChange={(callSettings) => updateCallSettings(row.modelId, callSettings)}
										onCatalogReasoningChange={(reasoning) => updateReasoning(row.modelId, reasoning)}
									/>
								{/key}
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	{/snippet}

	{#snippet footer()}
		<div class="flex justify-end gap-2">
			<Button onclick={oncancel}>{t('settings.cancel')}</Button>
			<Button variant="filled" onclick={done}>{t('settings.catalog.done')}</Button>
		</div>
	{/snippet}
</Modal>
