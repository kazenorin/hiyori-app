<script lang="ts">
	import { v4 as uuidv4 } from 'uuid';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { t } from '#lib/i18n/index.ts';
	import { isTauriSync } from '#lib/runtime.ts';
	import { resolveEndpoint, resolveProviderType } from '#lib/ai/catalog/eligibility.ts';
	import type { CatalogProviderEntity, EligibleProvider } from '#lib/ai/catalog/types.ts';
	import type { Provider } from '#lib/stores/settings.svelte.ts';
	import { projectCatalogEntries, type EntryDraft } from '#lib/features/settings/catalog-setup.ts';
	import Button from '#lib/components/ui/Button.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import TextField from '#lib/components/ui/TextField.svelte';
	import ProviderLogo from '#lib/components/catalog/ProviderLogo.svelte';
	import ModelSelector from '#lib/components/catalog/ModelSelector.svelte';

	interface Props {
		/** Persisted entity when editing; null when adding */
		entity: CatalogProviderEntity | null;
		/** Catalog data for the provider; null when unavailable (offline edit) */
		catalogProvider: EligibleProvider | null;
		focusEntryId?: string | null;
		onsave: (data: Omit<CatalogProviderEntity, 'id'>) => void;
		oncancel: () => void;
	}

	let { entity, catalogProvider, focusEntryId = null, onsave, oncancel }: Props = $props();

	const PROVIDER_LABEL_KEYS: Record<Provider, string> = {
		openai: 'settings.providers.openai',
		openrouter: 'settings.providers.openrouter',
		ollama: 'settings.providers.ollama',
		'openai-compatible': 'settings.providers.openaiCompatible',
	};

	// svelte-ignore state_referenced_locally
	let displayName = $state(entity?.displayName ?? catalogProvider?.name ?? '');
	// svelte-ignore state_referenced_locally
	let apiKey = $state(entity?.apiKey ?? '');
	// svelte-ignore state_referenced_locally
	let baseURL = $state(entity?.baseURL ?? (catalogProvider ? resolveEndpoint(catalogProvider) : ''));
	// svelte-ignore state_referenced_locally
	let corsBypassEnabled = $state(entity?.corsBypassEnabled ?? false);
	// svelte-ignore state_referenced_locally
	let wispProxyUrl = $state(entity?.wispProxyUrl ?? 'ws://localhost:6001');

	// svelte-ignore state_referenced_locally
	const selectedIds = new SvelteSet<string>((entity?.enabledModels ?? []).map((entry) => entry.modelId));
	// svelte-ignore state_referenced_locally
	const drafts = new SvelteMap<string, EntryDraft>(
		(entity?.enabledModels ?? []).map((entry) => [
			entry.modelId,
			{ callSettings: entry.callSettings, reasoningToggle: entry.reasoningToggle, reasoningBudget: entry.reasoningBudget },
		])
	);

	// svelte-ignore state_referenced_locally
	const initialFocusModelId = focusEntryId ? (entity?.enabledModels.find((entry) => entry.id === focusEntryId)?.modelId ?? null) : null;
	let selectorOpen = $state(initialFocusModelId !== null);
	let pendingFocusModelId = $state<string | null>(initialFocusModelId);

	const liveModels = $derived(catalogProvider?.models ?? []);
	const providerName = $derived(catalogProvider?.name ?? entity?.displayName ?? '');
	const providerType = $derived<Provider>(
		catalogProvider ? resolveProviderType(catalogProvider.npm) : (entity?.enabledModels[0]?.providerType ?? 'openai-compatible')
	);
	const catalogModelCount = $derived(
		catalogProvider ? catalogProvider.models.filter((model) => model.status !== 'deprecated').length : null
	);
	const canSave = $derived(selectedIds.size > 0);

	function openSelector(): void {
		selectorOpen = true;
	}

	function handleSelectorDone(result: { selectedIds: Set<string>; drafts: Map<string, EntryDraft> }): void {
		selectedIds.clear();
		for (const modelId of result.selectedIds) selectedIds.add(modelId);
		drafts.clear();
		for (const [modelId, draft] of result.drafts) drafts.set(modelId, draft);
		selectorOpen = false;
		pendingFocusModelId = null;
	}

	function handleSelectorCancel(): void {
		selectorOpen = false;
		pendingFocusModelId = null;
	}

	function handleSave(): void {
		const catalogId = entity?.catalogId ?? catalogProvider?.id;
		if (!catalogId || !canSave) return;
		const enabledModels = projectCatalogEntries({
			provider: catalogProvider,
			liveModels: catalogProvider?.models ?? [],
			existingEntries: entity?.enabledModels ?? [],
			selectedIds,
			drafts,
			newId: uuidv4,
		});
		onsave({
			catalogId,
			displayName: displayName.trim() || providerName,
			apiKey: apiKey.trim() ? apiKey : undefined,
			baseURL,
			corsBypassEnabled,
			wispProxyUrl,
			enabledModels,
		});
	}
</script>

<div class="space-y-4">
	<div class="flex flex-wrap items-center gap-2">
		<button class="btn preset-tonal btn-sm inline-flex min-h-11 items-center gap-1.5 px-2.5" type="button" onclick={oncancel}>
			<Icon name="chevron-left" class="h-4 w-4" />
			{t('settings.back')}
		</button>
		<span class="text-xs text-surface-500">
			{entity ? t('settings.catalog.editingProvider') : t('settings.catalog.addingProvider')}
		</span>
	</div>

	<div class="flex items-center gap-3">
		<ProviderLogo id={entity?.catalogId ?? catalogProvider?.id ?? ''} name={providerName} size="lg" />
		<div class="min-w-0">
			<p class="truncate text-lg font-medium">{providerName}</p>
			<p class="text-xs text-surface-500">
				{t(PROVIDER_LABEL_KEYS[providerType])}
				{#if catalogModelCount !== null}
					· {t('settings.catalog.catalogModels', { count: catalogModelCount })}
				{:else if entity}
					· {t('settings.catalog.nModels', { count: entity.enabledModels.length })}
				{/if}
			</p>
		</div>
	</div>

	<TextField label={t('settings.catalog.displayName')} type="text" bind:value={displayName} />

	<TextField label={t('settings.catalog.apiKey')} type="password" bind:value={apiKey} hint={t('settings.catalog.apiKeyHint')} />

	<details class="rounded-(--radius-container) border border-surface-200-800 p-3">
		<summary class="cursor-pointer text-sm font-medium">{t('settings.catalog.connection')}</summary>
		<div class="mt-3 space-y-3">
			<TextField label={t('settings.catalog.endpoint')} type="url" bind:value={baseURL} />
			{#if !isTauriSync()}
				<label class="flex items-center gap-2">
					<input type="checkbox" class="checkbox" bind:checked={corsBypassEnabled} />
					<span class="text-sm font-medium text-surface-700-300">{t('settings.bypassCorsViaWispProxy')}</span>
				</label>
				{#if corsBypassEnabled}
					<TextField
						label={t('settings.wispProxyUrl')}
						type="url"
						placeholder="ws://localhost:6001"
						bind:value={wispProxyUrl}
						hint={t('settings.wispProxyUrlHint')}
					/>
				{/if}
			{/if}
		</div>
	</details>

	<div>
		<span class="text-sm font-medium text-surface-700-300">{t('settings.catalog.models')}</span>
		<button
			type="button"
			class="mt-1 flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-surface-200-800 bg-surface-50-950 px-4 text-left text-sm text-surface-950-50 transition-colors hover:bg-surface-100-900"
			onclick={openSelector}
		>
			<span class="truncate" class:opacity-50={!canSave}>
				{canSave
					? `${t('settings.catalog.selectModels')} — ${t('settings.catalog.nSelected', { count: selectedIds.size })}`
					: t('settings.catalog.selectModels')}
			</span>
			<Icon name="chevron-down" class="h-4 w-4 shrink-0 opacity-50" />
		</button>
		<span class="mt-1 block text-xs text-surface-500">
			{entity && !catalogProvider ? t('settings.catalog.offlineSnapshots') : t('settings.catalog.selectionHint')}
		</span>
	</div>

	<div class="flex flex-wrap items-center gap-2">
		<Button variant="filled" class="min-h-11" disabled={!canSave} onclick={handleSave}>{t('settings.save')}</Button>
		<Button class="min-h-11" onclick={oncancel}>{t('settings.cancel')}</Button>
		{#if !canSave}
			<span class="self-center text-xs text-surface-500">{t('settings.catalog.selectAtLeastOne')}</span>
		{/if}
	</div>
</div>

{#if selectorOpen}
	<ModelSelector
		provider={catalogProvider}
		{providerName}
		{liveModels}
		existingEntries={entity?.enabledModels ?? []}
		initialSelection={selectedIds}
		initialDrafts={drafts}
		focusModelId={pendingFocusModelId}
		ondone={handleSelectorDone}
		oncancel={handleSelectorCancel}
	/>
{/if}
