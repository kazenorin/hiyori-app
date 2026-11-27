<script lang="ts">
	import { onMount } from 'svelte';
	import Sortable from 'sortablejs';
	import { t } from '#lib/i18n/index.ts';
	import { getCatalog } from '#lib/ai/catalog/service.ts';
	import { resolveEndpoint, resolveProviderType } from '#lib/ai/catalog/eligibility.ts';
	import type { CatalogModelEntry, CatalogProviderEntity, CatalogResult, EligibleProvider } from '#lib/ai/catalog/types.ts';
	import { deleteCatalogProvider, reorderCatalogProviders, settings, type Provider } from '#lib/stores/settings.svelte.ts';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import ProviderLogo from '#lib/components/catalog/ProviderLogo.svelte';
	import CatalogBrowser from './CatalogBrowser.svelte';

	type View = 'list' | 'browser' | 'setup';

	const PROVIDER_LABEL_KEYS: Record<Provider, string> = {
		openai: 'settings.providers.openai',
		openrouter: 'settings.providers.openrouter',
		ollama: 'settings.providers.ollama',
		'openai-compatible': 'settings.providers.openaiCompatible',
	};
	const STATUS_LABEL_KEYS = {
		alpha: 'settings.catalog.statusAlpha',
		beta: 'settings.catalog.statusBeta',
		deprecated: 'settings.catalog.statusDeprecated',
	} as const;

	let view = $state<View>('list');
	let setupEntityId = $state<string | null>(null);
	let setupProvider = $state<EligibleProvider | null>(null);
	let catalog = $state<CatalogResult | null>(null);

	let entityListEl = $state<HTMLDivElement | null>(null);
	let sortable: Sortable | null = null;

	const catalogProviders = $derived(new Map((catalog?.providers ?? []).map((provider) => [provider.id, provider])));
	const totalModels = $derived(settings.catalogProviders.reduce((sum, entity) => sum + entity.enabledModels.length, 0));
	const setupEntity = $derived(setupEntityId ? settings.catalogProviders.find((entity) => entity.id === setupEntityId) : undefined);
	const setupCatalogProvider = $derived(setupEntity ? catalogProviders.get(setupEntity.catalogId) : (setupProvider ?? undefined));
	const setupProviderType = $derived(
		setupCatalogProvider
			? resolveProviderType(setupCatalogProvider.npm)
			: (setupEntity?.enabledModels[0]?.providerType ?? 'openai-compatible')
	);
	const setupCatalogName = $derived(setupCatalogProvider?.name ?? setupEntity?.displayName ?? setupProvider?.name ?? '');
	const setupLogoId = $derived(setupEntity?.catalogId ?? setupProvider?.id ?? '');
	const setupModelCount = $derived(
		setupEntity
			? t('settings.catalog.nModels', { count: setupEntity.enabledModels.length })
			: t('settings.catalog.catalogModels', { count: countCurrentModels(setupCatalogProvider) })
	);

	onMount(() => {
		void getCatalog()
			.then((result) => (catalog = result))
			.catch(() => {});
	});

	$effect(() => {
		if (view !== 'list' || !entityListEl) return;
		if (!sortable) {
			const list = entityListEl;
			sortable = Sortable.create(list, {
				animation: 150,
				handle: '[data-catalog-drag-handle]',
				onEnd: () => {
					const order = [...list.querySelectorAll<HTMLElement>('[data-catalog-entity-id]')].map((el) => el.dataset.catalogEntityId!);
					reorderCatalogProviders(order);
				},
			});
		}
		return () => {
			sortable?.destroy();
			sortable = null;
		};
	});

	function countCurrentModels(provider: EligibleProvider | undefined): number {
		return provider ? provider.models.filter((model) => model.status !== 'deprecated').length : 0;
	}

	function startAddProvider(): void {
		setupEntityId = null;
		setupProvider = null;
		view = 'browser';
	}

	function startSetup(provider: EligibleProvider): void {
		setupEntityId = null;
		setupProvider = provider;
		view = 'setup';
	}

	function startEdit(entity: CatalogProviderEntity): void {
		setupEntityId = entity.id;
		setupProvider = null;
		view = 'setup';
	}

	function backFromSetup(): void {
		view = setupEntityId ? 'list' : 'browser';
	}

	function catalogNameOf(entity: CatalogProviderEntity): string | undefined {
		const provider = catalogProviders.get(entity.catalogId);
		return provider && provider.name !== entity.displayName ? provider.name : undefined;
	}

	function isModelListed(entity: CatalogProviderEntity, entry: CatalogModelEntry): boolean {
		if (!catalog) return true;
		const provider = catalogProviders.get(entity.catalogId);
		return provider ? provider.models.some((model) => model.id === entry.modelId) : false;
	}

	function hostOf(url: string): string {
		try {
			return new URL(url).host;
		} catch {
			return url;
		}
	}

	function statusLabelKey(status: NonNullable<CatalogModelEntry['snapshot']['status']>): string {
		return STATUS_LABEL_KEYS[status];
	}
</script>

{#if view === 'list'}
	<Card>
		<div class="flex flex-wrap items-center justify-between gap-2">
			<p class="text-xs text-surface-500">
				{t('settings.catalog.providerCount', { count: settings.catalogProviders.length })}
				·
				{t('settings.catalog.nModels', { count: totalModels })}
			</p>
			<Button class="min-h-11" onclick={startAddProvider}>{t('settings.catalog.addProvider')}</Button>
		</div>

		{#if settings.catalogProviders.length === 0}
			<p class="py-6 text-center text-sm text-surface-500">{t('settings.catalog.noProviders')}</p>
		{:else}
			<div bind:this={entityListEl} class="space-y-3">
				{#each settings.catalogProviders as entity (entity.id)}
					<div data-catalog-entity-id={entity.id} class="overflow-hidden rounded-(--radius-container) border border-surface-200-800">
						<div class="flex items-center gap-2 p-3 md:p-4">
							<span data-catalog-drag-handle class="shrink-0 cursor-grab touch-none text-surface-400-600" aria-hidden="true">
								<Icon name="grip-vertical" class="h-4 w-4" />
							</span>
							<button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" onclick={() => startEdit(entity)}>
								<ProviderLogo id={entity.catalogId} name={entity.displayName} />
								<div class="min-w-0">
									<div class="flex flex-wrap items-center gap-1.5">
										<span class="truncate text-sm font-medium">{entity.displayName}</span>
										<span class="badge preset-tonal text-[10px] {entity.apiKey ? 'text-success-500' : ''}">
											{entity.apiKey ? t('settings.catalog.keySet') : t('settings.catalog.noKey')}
										</span>
										<span class="badge preset-tonal text-[10px]">
											{t('settings.catalog.nModels', { count: entity.enabledModels.length })}
										</span>
									</div>
									<p class="truncate text-xs text-surface-500">
										{[catalogNameOf(entity), hostOf(entity.baseURL)].filter(Boolean).join(' · ')}
									</p>
								</div>
							</button>
							<div class="flex shrink-0 items-center gap-1">
								<button class="btn preset-tonal min-h-11 px-2 py-1 text-xs" type="button" onclick={() => startEdit(entity)}>
									{t('settings.edit')}
								</button>
								<button
									class="btn preset-tonal min-h-11 px-2 py-1 text-xs text-error-700-300"
									type="button"
									onclick={() => deleteCatalogProvider(entity.id)}
								>
									{t('settings.delete')}
								</button>
							</div>
						</div>

						<div class="border-t border-surface-200-800">
							{#each entity.enabledModels as entry (entry.id)}
								<div
									class="flex items-center gap-2 border-b border-surface-200-800 py-2 pl-4 pr-3 last:border-b-0 hover:bg-surface-100-900 md:pl-5"
								>
									<div class="min-w-0 flex-1">
										<div class="flex flex-wrap items-center gap-1.5">
											<span class="truncate text-sm font-medium">{entry.snapshot.name}</span>
											{#if entry.snapshot.status}
												<span class="badge preset-tonal text-[10px] text-warning-600-400">{t(statusLabelKey(entry.snapshot.status))}</span>
											{/if}
											{#if entry.snapshot.reasoning}
												<span class="badge preset-tonal text-[10px]">{t('settings.catalog.capabilityReasoning')}</span>
											{/if}
											{#if entry.snapshot.tool_call}
												<span class="badge preset-tonal text-[10px]">{t('settings.catalog.capabilityTools')}</span>
											{/if}
											{#if entry.snapshot.attachment}
												<span class="badge preset-tonal text-[10px]">{t('settings.catalog.capabilityVision')}</span>
											{/if}
											{#if !isModelListed(entity, entry)}
												<span class="badge preset-tonal text-[10px] text-error-700-300">{t('settings.catalog.noLongerListed')}</span>
											{/if}
										</div>
										<p class="truncate text-xs text-surface-500">{entry.modelId}</p>
									</div>
									<button
										class="btn preset-ghost min-h-11 min-w-11 shrink-0 px-2"
										type="button"
										title={t('settings.catalog.advancedSettings')}
										aria-label={t('settings.catalog.advancedSettings')}
										onclick={() => startEdit(entity)}
									>
										<Icon name="cog" class="h-4 w-4" />
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</Card>
{:else if view === 'browser'}
	<Card>
		<CatalogBrowser onback={() => (view = 'list')} onselect={startSetup} />
	</Card>
{:else}
	<Card>
		<div class="flex flex-wrap items-center gap-2">
			<button class="btn preset-tonal btn-sm inline-flex min-h-11 items-center gap-1.5 px-2.5" type="button" onclick={backFromSetup}>
				<Icon name="chevron-left" class="h-4 w-4" />
				{t('settings.back')}
			</button>
			<span class="text-xs text-surface-500">
				{setupEntity ? t('settings.catalog.editingProvider') : t('settings.catalog.addingProvider')}
			</span>
		</div>

		<div class="flex items-center gap-3">
			<ProviderLogo id={setupLogoId} name={setupCatalogName} size="lg" />
			<div class="min-w-0">
				<p class="truncate text-lg font-medium">{setupCatalogName}</p>
				<p class="text-xs text-surface-500">{t(PROVIDER_LABEL_KEYS[setupProviderType])} · {setupModelCount}</p>
			</div>
		</div>

		{#if setupEntity}
			<dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
				<div class="min-w-0">
					<dt class="text-xs text-surface-500">{t('settings.catalog.displayName')}</dt>
					<dd class="truncate">{setupEntity.displayName}</dd>
				</div>
				<div class="min-w-0">
					<dt class="text-xs text-surface-500">{t('settings.catalog.endpoint')}</dt>
					<dd class="truncate">{setupEntity.baseURL}</dd>
				</div>
				<div>
					<dt class="text-xs text-surface-500">{t('settings.catalog.apiKey')}</dt>
					<dd>{setupEntity.apiKey ? t('settings.catalog.keySet') : t('settings.catalog.noKey')}</dd>
				</div>
				<div>
					<dt class="text-xs text-surface-500">{t('settings.catalog.models')}</dt>
					<dd>{t('settings.catalog.nModels', { count: setupEntity.enabledModels.length })}</dd>
				</div>
			</dl>
		{:else}
			<dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
				<div class="min-w-0">
					<dt class="text-xs text-surface-500">{t('settings.catalog.endpoint')}</dt>
					<dd class="truncate">{setupCatalogProvider ? resolveEndpoint(setupCatalogProvider) : ''}</dd>
				</div>
				<div>
					<dt class="text-xs text-surface-500">{t('settings.catalog.models')}</dt>
					<dd>{t('settings.catalog.catalogModels', { count: countCurrentModels(setupCatalogProvider) })}</dd>
				</div>
			</dl>
		{/if}
	</Card>
{/if}
