<script lang="ts">
	import { onMount } from 'svelte';
	import { ArrowLeft, RefreshCw, Search } from '@lucide/svelte';
	import { t } from '#lib/i18n/index.ts';
	import { getCatalog, refreshCatalog } from '#lib/ai/catalog/service.ts';
	import type { CatalogResult, EligibleProvider } from '#lib/ai/catalog/types.ts';
	import Button from '#lib/components/ui/Button.svelte';
	import ProviderLogo from '#lib/components/catalog/ProviderLogo.svelte';

	interface Props {
		onback: () => void;
		onselect: (provider: EligibleProvider) => void;
	}

	let { onback, onselect }: Props = $props();

	const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
	const SKELETON_CARDS = Array.from({ length: 12 }, (_, index) => index);

	let catalog = $state<CatalogResult | null>(null);
	let isLoading = $state(true);
	let isRefreshing = $state(false);
	let loadError = $state<string | null>(null);
	let search = $state('');
	let gridEl = $state<HTMLDivElement | null>(null);

	const query = $derived(search.trim().toLowerCase());
	const cards = $derived(
		(catalog?.providers ?? [])
			.filter((provider) => !query || provider.name.toLowerCase().includes(query) || provider.id.toLowerCase().includes(query))
			.map((provider) => ({
				provider,
				modelCount: provider.models.filter((model) => model.status !== 'deprecated').length,
			}))
	);
	const presentLetters = $derived(new Set(cards.map((card) => firstLetter(card.provider))));
	const offline = $derived(catalog?.source === 'bundled');

	async function load(refresh: boolean): Promise<void> {
		if (isRefreshing) return;
		if (refresh) isRefreshing = true;
		else isLoading = true;
		loadError = null;
		try {
			catalog = refresh ? await refreshCatalog() : await getCatalog();
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
		} finally {
			isLoading = false;
			isRefreshing = false;
		}
	}

	function sourceLabel(source: CatalogResult['source']): string {
		if (source === 'live') return t('settings.catalog.liveCatalog');
		if (source === 'cache') return t('settings.catalog.cachedCatalog');
		return t('settings.catalog.bundledCatalog');
	}

	function firstLetter(provider: EligibleProvider): string {
		return provider.name.charAt(0).toUpperCase();
	}

	function jumpToLetter(letter: string): void {
		gridEl?.querySelector<HTMLElement>(`[data-letter-anchor="${letter}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

	onMount(() => {
		void load(false);
	});
</script>

<div class="mb-4 flex flex-wrap items-center gap-2">
	<button class="btn preset-tonal btn-sm inline-flex min-h-11 items-center gap-1.5 px-2.5" type="button" onclick={onback}>
		<ArrowLeft size={16} />
		{t('settings.back')}
	</button>
	<h3 class="h5 font-display">{t('settings.catalog.chooseProvider')}</h3>
</div>

<div class="relative mb-4">
	<Search size={16} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
	<input
		class="input pl-9"
		type="search"
		placeholder={t('settings.catalog.searchProviders')}
		aria-label={t('settings.catalog.searchProviders')}
		bind:value={search}
	/>
</div>

{#if isLoading}
	<div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4" aria-busy="true">
		{#each SKELETON_CARDS as index (index)}
			<div class="h-28 animate-pulse rounded-(--radius-container) bg-surface-200-800"></div>
		{/each}
	</div>
{:else if loadError}
	<div
		class="flex items-center justify-between gap-3 rounded-(--radius-container) border border-error-500/50 bg-error-100-900 p-3 text-sm text-error-600-400"
	>
		<span>{t('settings.catalog.loadFailed')}</span>
		<Button size="sm" onclick={() => load(false)}>{t('settings.catalog.retry')}</Button>
	</div>
{:else if catalog}
	{#if offline}
		<div
			class="mb-3 flex items-center justify-between gap-3 rounded-(--radius-container) border border-warning-500/50 bg-warning-100-900 p-3 text-sm text-warning-600-400"
		>
			<span>{t('settings.catalog.bundledBanner')}</span>
			<Button size="sm" onclick={() => load(true)}>{t('settings.catalog.retry')}</Button>
		</div>
	{/if}

	<div class="mb-3 flex flex-wrap items-center gap-2 text-xs text-surface-500">
		<span class="h-1.5 w-1.5 shrink-0 rounded-full {offline ? 'bg-error-500' : 'bg-success-500'}"></span>
		<span>
			{sourceLabel(catalog.source)} · {t('settings.catalog.dataDate', { date: catalog.generatedAt.slice(0, 10) })}
			{#if catalog.source === 'live'}
				· {t('settings.catalog.fetchedJustNow')}
			{/if}
		</span>
		<Button class="ml-auto min-h-9" size="sm" onclick={() => load(true)} disabled={isRefreshing}>
			<span class="inline-flex items-center gap-1.5">
				<RefreshCw size={14} class={isRefreshing ? 'animate-spin' : ''} />
				{t('settings.catalog.refresh')}
			</span>
		</Button>
	</div>

	<p class="mb-2 text-xs text-surface-500">
		{query
			? t('settings.catalog.matchCount', { count: cards.length, query: search.trim() })
			: t('settings.catalog.providerCount', { count: cards.length })}
	</p>

	<div class="flex items-start gap-3">
		<div bind:this={gridEl} class="grid flex-1 grid-cols-2 content-start gap-2.5 sm:grid-cols-3 md:grid-cols-4">
			{#if cards.length === 0}
				<div class="col-span-full flex flex-col items-center gap-3 py-10 text-sm text-surface-500">
					<p>{t('settings.catalog.noMatches')}</p>
					<Button size="sm" onclick={() => (search = '')}>{t('settings.catalog.clearSearch')}</Button>
				</div>
			{:else}
				{#each cards as card, index (card.provider.id)}
					{#if !query && (index === 0 || firstLetter(card.provider) !== firstLetter(cards[index - 1].provider))}
						<div
							class="col-span-full px-0.5 pt-1 text-[11px] font-bold tracking-widest text-primary-500"
							data-letter-anchor={firstLetter(card.provider)}
						>
							{firstLetter(card.provider)}
						</div>
					{/if}
					<button
						type="button"
						class="flex min-h-28 flex-col items-center justify-center gap-2 rounded-(--radius-container) border border-surface-200-800 bg-surface-100-900 p-3 text-center transition-colors hover:border-primary-500 hover:bg-surface-200-800"
						onclick={() => onselect(card.provider)}
					>
						<ProviderLogo id={card.provider.id} name={card.provider.name} />
						<span class="line-clamp-2 text-xs font-medium leading-snug">{card.provider.name}</span>
						<span class="text-[10px] text-surface-500">{t('settings.catalog.nModels', { count: card.modelCount })}</span>
					</button>
				{/each}
			{/if}
		</div>

		<div class="sticky top-0 hidden max-h-[70vh] flex-col gap-px self-start overflow-y-auto md:flex">
			{#each LETTERS as letter (letter)}
				<button
					type="button"
					class="w-6 rounded-(--radius-base) py-0.5 text-[10px] text-surface-500 transition-colors hover:bg-surface-200-800 hover:text-primary-500 disabled:cursor-default disabled:opacity-30"
					disabled={!!query || !presentLetters.has(letter)}
					onclick={() => jumpToLetter(letter)}
				>
					{letter}
				</button>
			{/each}
		</div>
	</div>
{/if}
