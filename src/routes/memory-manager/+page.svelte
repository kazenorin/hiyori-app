<script lang="ts">
	import { goto } from '$app/navigation';
	import { Memory, type MemoryItem, type LocationItem, type AliasGroup } from '$lib/features/memory';
	import type { InventoryItem } from '$lib/features/memory/inventory-types';
	import { getEmbeddingProviderConfig, getMemoryProviderConfig, isMemoryAvailable } from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';
	import { sampleSize } from 'lodash-es';
	import {
		getActiveStory,
		getActiveAct,
		getActiveActLine,
		getActiveStoryId,
		getActiveActLineId,
		getActiveActId,
	} from '$lib/stores/stories.svelte';
	import {
		regenerateMemoriesForCurrentLine,
		getIsRegenerating,
		getRegenError,
		getLastRegenResult,
	} from '$lib/stores/memory-regeneration.svelte';
	import { streamActCard } from '$lib/features/act-card-generator';
	import { log } from '$lib/logging/logger';
	import { traceActLineChain } from '$lib/db/act-lines';
	import Modal from '$lib/components/ui/Modal.svelte';

	let inventoryItems = $state<InventoryItem[]>([]);
	let aliasGroups = $state<AliasGroup[]>([]);
	let locations = $state<LocationItem[]>([]);
	let searchQuery = $state('');
	let searchResults = $state<MemoryItem[]>([]);
	let locationSearchQuery = $state('');
	let locationSearchResults = $state<MemoryItem[]>([]);
	let locationQuery = $state('');
	let locationQueryLocation = $state('');
	let locationQueryResults = $state<MemoryItem[]>([]);
	let status = $state('');
	let isLoading = $state(false);
	let includeLineage = $state(false);
	let lineageCount = $state(1);

	const searchLimit = 5;

	function dedup(items: MemoryItem[]): MemoryItem[] {
		const seen = new Set<string>();
		return items
			.filter((item) => {
				if (seen.has(item.id)) return false;
				seen.add(item.id);
				return true;
			})
			.sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity));
	}

	// Generation state
	let isGeneratingAct = $state(false);
	let consoleOutput = $state('');
	let consoleRef = $state<HTMLPreElement | null>(null);
	let progressUpdates = $state<Array<{ time: Date; message: string }>>([]);
	let confirmDialog = $state<{ title: string; message: string; onConfirm: () => void } | null>(null);

	const embeddingConfig = $derived(getEmbeddingProviderConfig());
	const memoryConfig = $derived(getMemoryProviderConfig());
	const activeStory = $derived(getActiveStory());
	const activeAct = $derived(getActiveAct());
	const activeActLine = $derived(getActiveActLine());
	const activeStoryId = $derived(getActiveStoryId());
	const activeActLineId = $derived(getActiveActLineId());
	const _activeActId = $derived(getActiveActId());

	async function resolveLineage(withLineage: boolean): Promise<{ ids: string[]; count: number }> {
		if (!withLineage || !activeActLineId) {
			return { ids: activeActLineId ? [activeActLineId] : [], count: 1 };
		}
		if (activeAct?.actNumber && activeAct.actNumber === 1) {
			return { ids: activeActLineId ? [activeActLineId] : [], count: 1 };
		}
		const chain = await traceActLineChain(activeActLineId);
		return { ids: chain.map((l) => l.actLineId), count: chain.length };
	}

	function providerLabel(config: { name: string; model: string } | undefined, role: string): string {
		if (!config) return t('memoryManager.noMemoryProvider', { role });
		return `${config.name} (${config.model})`;
	}

	async function loadMemories(ids: string[]) {
		if (!embeddingConfig || !activeStoryId) {
			status = !activeStoryId ? t('memoryManager.noStory') : t('memoryManager.noProvider');
			return;
		}
		const memory = new Memory(embeddingConfig);
		locations = await memory.getAllLocations({ storyId: activeStoryId, actLineIds: ids });
		if (ids.length > 0) {
			try {
				inventoryItems = await memory.getAllInventory(activeStoryId, ids);
				aliasGroups = await memory.getAllAliases(activeStoryId, ids);
			} catch {
				inventoryItems = [];
				aliasGroups = [];
			}
		} else {
			inventoryItems = [];
			aliasGroups = [];
		}
	}

	function appendConsole(text: string) {
		consoleOutput += text + '\n';
		// Auto-scroll to bottom
		requestAnimationFrame(() => {
			if (consoleRef) consoleRef.scrollTop = consoleRef.scrollHeight;
		});
	}

	function addProgress(message: string) {
		progressUpdates = [...progressUpdates, { time: new Date(), message }];
		appendConsole(message);
	}

	async function handleGenerateActCard() {
		if (!activeActLineId) {
			status = t('memoryManager.noActLineSelected');
			return;
		}
		confirmDialog = {
			title: t('memoryManager.generateActCard'),
			message: t('memoryManager.actCardOverrideConfirm'),
			onConfirm: doGenerateActCard,
		};
	}

	async function doGenerateActCard() {
		isGeneratingAct = true;
		consoleOutput = '';
		progressUpdates = [];
		status = '';

		try {
			addProgress(t('memoryManager.generatingActCard'));
			const result = await streamActCard((state) => {
				const text = state.content || state.reasoning || '';
				if (text) {
					consoleOutput = text;
					requestAnimationFrame(() => {
						if (consoleRef) consoleRef.scrollTop = consoleRef.scrollHeight;
					});
				}
			});
			addProgress(t('memoryManager.actCardSaved', { file: result.filePath.split('/').pop() ?? 'unknown' }));
			status = t('memoryManager.actCardGenerated');
		} catch (err) {
			const msg = err instanceof Error ? err.message : t('memoryManager.generationFailed');
			addProgress(`${t('memoryManager.errorPrefix')} ${msg}`);
			status = msg;
			await log.error('memory-manager', 'Act card generation failed', err);
		} finally {
			isGeneratingAct = false;
		}
	}

	async function handleRegenerateMemories() {
		if (!activeActLineId) {
			status = t('memoryManager.noActLineSelected');
			return;
		}
		confirmDialog = {
			title: t('memoryManager.regenerateMemories'),
			message: t('memoryManager.regenerateMemoriesConfirm'),
			onConfirm: doRegenerateMemories,
		};
	}

	async function doRegenerateMemories() {
		consoleOutput = '';
		progressUpdates = [];
		status = '';

		addProgress(t('memoryManager.startingMemoryRegeneration'));
		await regenerateMemoriesForCurrentLine((msg) => addProgress(msg));

		const error = getRegenError();
		const result = getLastRegenResult();
		if (error) {
			addProgress(`${t('memoryManager.errorPrefix')} ${error}`);
			status = error;
		} else if (result) {
			addProgress(`Complete: ${result}`);
			status = t('memoryManager.regenerationComplete', { result });
			const { ids } = await resolveLineage(includeLineage);
			await loadMemories(ids);
		}
	}

	async function handleSearch() {
		if (!searchQuery.trim() || !embeddingConfig || !activeStoryId) return;
		isLoading = true;
		status = t('memoryManager.searchingMemories');
		try {
			const { ids } = await resolveLineage(includeLineage);
			const memory = new Memory(embeddingConfig);
			const resolved = await memory.resolveAliases(activeStoryId, ids, searchQuery.trim());
			const all = await Promise.all(
				resolved.map((name) => memory.search(name, { storyId: activeStoryId, actLineIds: ids, limit: searchLimit }))
			);
			searchResults = dedup(all.flat()).slice(0, searchLimit);
			status = t('memoryManager.foundResults', { count: searchResults.length });
		} catch (err) {
			status = err instanceof Error ? err.message : t('memoryManager.searchFailed');
			searchResults = [];
		} finally {
			isLoading = false;
		}
	}

	async function handleLocationSearch() {
		if (!locationSearchQuery.trim() || !embeddingConfig || !activeStoryId) return;
		isLoading = true;
		status = t('memoryManager.searchingLocations');
		try {
			const { ids } = await resolveLineage(includeLineage);
			const memory = new Memory(embeddingConfig);
			const locs = await memory.searchLocations(locationSearchQuery.trim(), {
				storyId: activeStoryId,
				actLineIds: ids,
				limit: searchLimit,
			});
			const sampled = await Promise.all(locs.map((loc) => memory.sampleByLocation(loc, searchLimit)));
			locationSearchResults = sampleSize(sampled.flat(), searchLimit);
			status = t('memoryManager.foundResults', { count: locationSearchResults.length });
		} catch (err) {
			status = err instanceof Error ? err.message : t('memoryManager.locationSearchFailed');
			locationSearchResults = [];
		} finally {
			isLoading = false;
		}
	}

	async function handleLocationQuery() {
		if (!locationQuery.trim() || !locationQueryLocation.trim() || !embeddingConfig || !activeStoryId) return;
		isLoading = true;
		status = t('memoryManager.searchingByLocation');
		try {
			const { ids } = await resolveLineage(includeLineage);
			const memory = new Memory(embeddingConfig);
			const resolved = await memory.resolveAliases(activeStoryId, ids, locationQuery.trim());
			const all = await Promise.all(
				resolved.map((name) =>
					memory.searchByLocation(name, locationQueryLocation.trim(), {
						storyId: activeStoryId,
						actLineIds: ids,
						limit: searchLimit,
					})
				)
			);
			locationQueryResults = dedup(all.flat()).slice(0, searchLimit);
			status = t('memoryManager.foundResultsByLocation', { count: locationQueryResults.length });
		} catch (err) {
			status = err instanceof Error ? err.message : t('memoryManager.searchByLocationFailed');
			locationQueryResults = [];
		} finally {
			isLoading = false;
		}
	}

	async function handleReset() {
		if (!embeddingConfig) return;
		confirmDialog = {
			title: t('memoryManager.resetAllMemories'),
			message: t('memoryManager.resetMemoriesConfirm'),
			onConfirm: doReset,
		};
	}

	async function doReset() {
		isLoading = true;
		aliasGroups = [];
		inventoryItems = [];
		locations = [];
		searchResults = [];
		locationSearchResults = [];
		locationQueryResults = [];
		try {
			if (embeddingConfig) {
				const memory = new Memory(embeddingConfig);
				await memory.reset();
				status = t('memoryManager.allMemoriesDeleted');
			}
		} catch (err) {
			status = err instanceof Error ? err.message : t('memoryManager.resetFailed');
		} finally {
			isLoading = false;
		}
	}

	$effect(() => {
		if (embeddingConfig && activeStoryId && isMemoryAvailable()) {
			searchResults = [];
			locationSearchResults = [];
			locationQueryResults = [];
			resolveLineage(includeLineage).then(({ ids, count }) => {
				lineageCount = count;
				loadMemories(ids);
			});
		}
	});
</script>

<div class="flex-1 overflow-y-auto p-3 md:p-4 lg:p-6">
	<div class="max-w-2xl mx-auto space-y-8">
		<h1 class="h2 font-display">{t('memoryManager.heading')}</h1>

		{#if isMemoryAvailable()}
			<section class="card p-4 space-y-2">
				<div class="flex items-center gap-2">
					<span class="text-xs text-surface-500 w-32 shrink-0">{t('memoryManager.story')}</span>
					<span class="text-sm font-medium">{activeStory?.name ?? t('memoryManager.noneSelected')}</span>
				</div>
				<div class="flex items-center gap-2">
					<span class="text-xs text-surface-500 w-32 shrink-0">{t('memoryManager.act')}</span>
					<span class="text-sm font-medium">{activeAct?.name ?? t('memoryManager.noneSelected')}</span>
				</div>
				<div class="flex items-center gap-2">
					<span class="text-xs text-surface-500 w-32 shrink-0">{t('memoryManager.actLine')}</span>
					<span class="text-sm font-medium">{activeActLine?.name ?? t('memoryManager.noneSelected')}</span>
				</div>
				<div class="flex items-center gap-2">
					<span class="text-xs text-surface-500 w-32 shrink-0">{t('memoryManager.scope')}</span>
					<label class="flex items-center gap-2 cursor-pointer">
						<input type="checkbox" bind:checked={includeLineage} />
						<span class="text-sm">
							{includeLineage ? t('memoryManager.includeLineage') : t('memoryManager.currentActOnly')}
						</span>
					</label>
				</div>
				{#if includeLineage && lineageCount > 1}
					<div class="flex items-center gap-2">
						<span class="text-xs text-surface-500 w-32 shrink-0"></span>
						<span class="text-xs text-surface-500">{t('memoryManager.lineageInfo', { count: lineageCount })}</span>
					</div>
				{/if}
				<div class="border-t border-surface-200-700 my-2"></div>
				<div class="flex items-center gap-2">
					<span class="text-xs text-surface-500 w-32 shrink-0">{t('memoryManager.memoryProvider')}</span>
					<span class="text-sm font-medium">{providerLabel(memoryConfig, 'memory')}</span>
				</div>
				<div class="flex items-center gap-2">
					<span class="text-xs text-surface-500 w-32 shrink-0">{t('memoryManager.embeddingProvider')}</span>
					<span class="text-sm font-medium">{providerLabel(embeddingConfig, 'embedding')}</span>
				</div>
			</section>
		{/if}

		{#if !isMemoryAvailable()}
			<p class="text-warning-700-300">{t('memoryManager.memoryDisabled')}</p>
		{:else if !activeStoryId}
			<p class="text-error-700-300">{t('memoryManager.noStorySelected')}</p>
		{:else if !embeddingConfig}
			<p class="text-error-700-300">{t('memoryManager.configureEmbedding')}</p>
		{/if}

		<!-- Generation Tools -->
		{#if isMemoryAvailable() && activeStoryId}
			<section class="card p-4 md:p-6 space-y-4">
				<h2 class="h4">{t('memoryManager.generationTools')}</h2>

				<div class="flex flex-wrap gap-2">
					<button
						class="btn preset-filled"
						type="button"
						onclick={handleGenerateActCard}
						disabled={!activeActLineId || isGeneratingAct || getIsRegenerating()}
					>
						{#if isGeneratingAct}
							{t('memoryManager.generating')}
						{:else}
							{t('memoryManager.generateActCard')}
						{/if}
					</button>
					<button
						class="btn preset-outlined"
						type="button"
						onclick={() => goto('/generate-character-cards')}
						disabled={!activeActLineId || isGeneratingAct || getIsRegenerating()}
					>
						{t('memoryManager.generateCharacterCards')}
					</button>
					<button
						class="btn preset-tonal"
						type="button"
						onclick={handleRegenerateMemories}
						disabled={!activeActLineId || isGeneratingAct || getIsRegenerating()}
					>
						{#if getIsRegenerating()}
							{t('memoryManager.regenerating')}
						{:else}
							{t('memoryManager.regenerateMemories')}
						{/if}
					</button>
				</div>

				{#if consoleOutput}
					<div class="bg-surface-900-100 text-surface-100-900 rounded-lg p-4 font-mono text-xs h-48 md:h-64 overflow-y-auto">
						<pre bind:this={consoleRef} class="whitespace-pre-wrap break-words">{consoleOutput}</pre>
					</div>

					<details>
						<summary class="text-sm font-medium cursor-pointer text-surface-500">{t('importWorld.fullLog')}</summary>
						<div class="mt-2 space-y-1 max-h-64 overflow-y-auto">
							{#each progressUpdates as update, i (i)}
								<p class="text-xs text-surface-500">
									<span class="font-mono">[{update.time.toLocaleTimeString()}]</span>
									{update.message}
								</p>
							{/each}
						</div>
					</details>
				{/if}
			</section>
		{/if}

		<!-- Search by Location -->
		<section class="card p-4 md:p-6 space-y-4">
			<h2 class="h4">{t('memoryManager.searchByLocation')}</h2>
			<input
				class="input w-full"
				type="text"
				placeholder={t('memoryManager.queryPlaceholder')}
				bind:value={locationQuery}
				disabled={isLoading || !activeStoryId}
			/>
			<input
				class="input w-full"
				type="text"
				placeholder={t('memoryManager.locationPlaceholder')}
				bind:value={locationQueryLocation}
				disabled={isLoading || !activeStoryId}
			/>
			<div class="flex gap-2">
				<button
					class="btn preset-filled"
					type="button"
					onclick={handleLocationQuery}
					disabled={isLoading || !locationQuery.trim() || !locationQueryLocation.trim() || !activeStoryId}
				>
					{t('memoryManager.search')}
				</button>
			</div>

			{#if locationQueryResults.length > 0}
				<div class="space-y-2 mt-4">
					<p class="text-sm font-medium text-surface-700-300">{t('memoryManager.results')}</p>
					{#each locationQueryResults as result (result.id)}
						<div class="p-3 rounded-[var(--radius-base)] bg-surface-100-900">
							<p class="text-sm">{result.memory}</p>
							<p class="text-xs text-surface-500">
								{t('memoryManager.character')}: {result.characterCanonicalName} · {t('memoryManager.location')}: {result.location} · {t(
									'memoryManager.distance'
								)}: {result.score?.toFixed(4) ?? 'N/A'}
							</p>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Search Memories -->
		<section class="card p-4 md:p-6 space-y-4">
			<h2 class="h4">{t('memoryManager.searchMemories')}</h2>
			<input
				class="input w-full"
				type="text"
				placeholder={t('memoryManager.queryPlaceholder')}
				bind:value={searchQuery}
				disabled={isLoading || !activeStoryId}
			/>
			<div class="flex gap-2">
				<button
					class="btn preset-filled"
					type="button"
					onclick={handleSearch}
					disabled={isLoading || !searchQuery.trim() || !activeStoryId}
				>
					{t('memoryManager.search')}
				</button>
			</div>

			{#if searchResults.length > 0}
				<div class="space-y-2 mt-4">
					<p class="text-sm font-medium text-surface-700-300">{t('memoryManager.results')}</p>
					{#each searchResults as result (result.id)}
						<div class="p-3 rounded-[var(--radius-base)] bg-surface-100-900">
							<p class="text-sm">{result.memory}</p>
							<p class="text-xs text-surface-500">
								{t('memoryManager.character')}: {result.characterCanonicalName} · {t('memoryManager.location')}: {result.location} · {t(
									'memoryManager.distance'
								)}: {result.score?.toFixed(4) ?? 'N/A'}
							</p>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Search Locations -->
		<section class="card p-4 md:p-6 space-y-4">
			<h2 class="h4">{t('memoryManager.searchLocations')}</h2>
			<input
				class="input w-full"
				type="text"
				placeholder={t('memoryManager.queryPlaceholder')}
				bind:value={locationSearchQuery}
				disabled={isLoading || !activeStoryId}
			/>
			<div class="flex gap-2">
				<button
					class="btn preset-filled"
					type="button"
					onclick={handleLocationSearch}
					disabled={isLoading || !locationSearchQuery.trim() || !activeStoryId}
				>
					{t('memoryManager.search')}
				</button>
			</div>

			{#if locationSearchResults.length > 0}
				<div class="space-y-2 mt-4">
					<p class="text-sm font-medium text-surface-700-300">{t('memoryManager.results')}</p>
					{#each locationSearchResults as result (result.id)}
						<div class="p-3 rounded-[var(--radius-base)] bg-surface-100-900">
							<p class="text-sm">{result.memory}</p>
							<p class="text-xs text-surface-500">
								{t('memoryManager.character')}: {result.characterCanonicalName} · {t('memoryManager.location')}: {result.location}
							</p>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Alias Groups -->
		<section class="card p-4 md:p-6 space-y-4">
			<div class="flex items-center justify-between">
				<h2 class="h4">{t('memoryManager.aliasGroups', { count: aliasGroups.length })}</h2>
			</div>

			{#if aliasGroups.length === 0}
				<p class="text-sm text-surface-500">{t('memoryManager.noAliases')}</p>
			{:else}
				<div class="space-y-2">
					{#each aliasGroups as ag (ag.group)}
						<div class="p-3 rounded-[var(--radius-base)] bg-surface-100-900">
							<p class="text-sm font-medium">{ag.group}</p>
							<p class="text-xs text-surface-500">{ag.aliases.join(', ')}</p>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- All Inventory -->
		<section class="card p-4 md:p-6 space-y-4">
			<div class="flex items-center justify-between">
				<h2 class="h4">{t('memoryManager.allLocations', { count: locations.length })}</h2>
			</div>

			{#if locations.length === 0}
				<p class="text-sm text-surface-500">{t('memoryManager.noLocations')}</p>
			{:else}
				<div class="space-y-2">
					{#each locations as loc (loc.id)}
						<div class="p-3 rounded-[var(--radius-base)] bg-surface-100-900">
							<p class="text-sm">{loc.location}</p>
							<p class="text-xs text-surface-500">{loc.createdAt}</p>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- All Inventory -->
		<section class="card p-4 md:p-6 space-y-4">
			<div class="flex items-center justify-between">
				<h2 class="h4">{t('memoryManager.allInventory', { count: inventoryItems.length })}</h2>
			</div>

			{#if inventoryItems.length === 0}
				<p class="text-sm text-surface-500">{t('memoryManager.noInventory')}</p>
			{:else}
				<div class="space-y-2">
					{#each inventoryItems as item (item.id)}
						<div class="p-3 rounded-[var(--radius-base)] bg-surface-100-900">
							<p class="text-sm font-medium">{item.itemName}</p>
							<p class="text-xs text-surface-500">
								{item.characterCanonicalName} &middot; {item.category} &middot; {item.equipStatus}
								{#if item.description}
									&middot; {item.description}
								{/if}
							</p>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Reset -->
		<section class="card p-4 md:p-6 space-y-4">
			<h2 class="h4">{t('memoryManager.dangerZone')}</h2>
			<button class="btn preset-tonal text-error-700-300" type="button" onclick={handleReset} disabled={isLoading}>
				{t('memoryManager.resetAllMemories')}
			</button>
		</section>

		{#if status}
			<p class="text-sm text-surface-500">{status}</p>
		{/if}
	</div>
</div>

<!-- Confirmation Dialog -->
<Modal open={confirmDialog !== null} title={confirmDialog?.title ?? ''} onclose={() => (confirmDialog = null)}>
	{#snippet body()}
		<p class="text-sm text-surface-600-400">
			{confirmDialog?.message ?? ''}
		</p>
	{/snippet}
	{#snippet footer()}
		<div class="flex justify-end gap-3">
			<button class="btn preset-tonal" type="button" onclick={() => (confirmDialog = null)}>
				{t('memoryManager.cancel')}
			</button>
			<button
				class="btn variant-filled"
				type="button"
				onclick={() => {
					const handler = confirmDialog?.onConfirm;
					confirmDialog = null;
					handler?.();
				}}
			>
				{t('memoryManager.confirm')}
			</button>
		</div>
	{/snippet}
</Modal>
