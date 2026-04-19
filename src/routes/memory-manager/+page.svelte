<script lang="ts">
	import { goto } from '$app/navigation';
	import { Memory, type MemoryItem, type LocationItem } from '$lib/memory/memory';
	import { getEmbeddingProviderConfig, getMemoryProviderConfig, settings } from '$lib/stores/settings.svelte';
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
	import { streamActCard } from '$lib/ai/act-card-generator';
	import { log } from '$lib/logging/logger';

	let memories = $state<MemoryItem[]>([]);
	let locations = $state<LocationItem[]>([]);
	let searchQuery = $state('');
	let searchResults = $state<MemoryItem[]>([]);
	let locationSearchQuery = $state('');
	let locationSearchResults = $state<LocationItem[]>([]);
	let locationQuery = $state('');
	let locationQueryLocation = $state('');
	let locationQueryResults = $state<MemoryItem[]>([]);
	let status = $state('');
	let isLoading = $state(false);

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
	const activeActId = $derived(getActiveActId());

	function providerLabel(config: { name: string; model: string } | undefined, role: string): string {
		if (!config) return `No ${role} provider configured`;
		return `${config.name} (${config.model})`;
	}

	async function loadMemories() {
		if (!embeddingConfig || !activeStoryId) {
			status = !activeStoryId ? 'No story selected.' : 'No provider configured.';
			return;
		}
		const memory = new Memory(embeddingConfig);
		memories = await memory.getAll({ storyId: activeStoryId, actLineId: activeActLineId ?? undefined });
		locations = await memory.getAllLocations({ storyId: activeStoryId, actLineId: activeActLineId ?? undefined });
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
			status = 'No active act line selected.';
			return;
		}
		confirmDialog = {
			title: 'Generate Act Card',
			message: 'The existing act card will be overridden. Continue?',
			onConfirm: doGenerateActCard,
		};
	}

	async function doGenerateActCard() {
		isGeneratingAct = true;
		consoleOutput = '';
		progressUpdates = [];
		status = '';

		try {
			addProgress('Generating act card...');
			const result = await streamActCard((state) => {
				const text = state.content || state.reasoning || '';
				if (text) {
					consoleOutput = text;
					requestAnimationFrame(() => {
						if (consoleRef) consoleRef.scrollTop = consoleRef.scrollHeight;
					});
				}
			});
			addProgress(`\nAct card saved: ${result.filePath.split('/').pop()}`);
			status = `Act card generated successfully.`;
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Generation failed.';
			addProgress(`Error: ${msg}`);
			status = msg;
			await log.error('memory-manager', 'Act card generation failed', err);
		} finally {
			isGeneratingAct = false;
		}
	}

	async function handleRegenerateMemories() {
		if (!activeActLineId) {
			status = 'No active act line selected.';
			return;
		}
		confirmDialog = {
			title: 'Regenerate Memories',
			message:
				'All existing memories for this act line will be deleted and re-extracted. This may take a while depending on the number of exchanges. Continue?',
			onConfirm: doRegenerateMemories,
		};
	}

	async function doRegenerateMemories() {
		consoleOutput = '';
		progressUpdates = [];
		status = '';

		addProgress('Starting memory regeneration...');
		await regenerateMemoriesForCurrentLine((msg) => addProgress(msg));

		const error = getRegenError();
		const result = getLastRegenResult();
		if (error) {
			addProgress(`Error: ${error}`);
			status = error;
		} else if (result) {
			addProgress(`Complete: ${result}`);
			status = `Regeneration complete: ${result}`;
			await loadMemories();
		}
	}

	async function handleSearch() {
		if (!searchQuery.trim() || !embeddingConfig || !activeStoryId) return;
		isLoading = true;
		status = 'Searching memories...';
		try {
			const memory = new Memory(embeddingConfig);
			searchResults = await memory.search(searchQuery.trim(), {
				storyId: activeStoryId,
				actLineId: activeActLineId ?? undefined,
				limit: 5,
			});
			status = `Found ${searchResults.length} result(s).`;
		} catch (err) {
			status = err instanceof Error ? err.message : 'Search failed';
			searchResults = [];
		} finally {
			isLoading = false;
		}
	}

	async function handleLocationSearch() {
		if (!locationSearchQuery.trim() || !embeddingConfig || !activeStoryId) return;
		isLoading = true;
		status = 'Searching locations...';
		try {
			const memory = new Memory(embeddingConfig);
			locationSearchResults = await memory.searchLocations(locationSearchQuery.trim(), {
				storyId: activeStoryId,
				actLineId: activeActLineId ?? undefined,
				limit: 5,
			});
			status = `Found ${locationSearchResults.length} location(s).`;
		} catch (err) {
			status = err instanceof Error ? err.message : 'Location search failed';
			locationSearchResults = [];
		} finally {
			isLoading = false;
		}
	}

	async function handleLocationQuery() {
		if (!locationQuery.trim() || !locationQueryLocation.trim() || !embeddingConfig || !activeStoryId) return;
		isLoading = true;
		status = 'Searching memories by location...';
		try {
			const memory = new Memory(embeddingConfig);
			locationQueryResults = await memory.searchByLocation(locationQuery.trim(), locationQueryLocation.trim(), {
				storyId: activeStoryId,
				actLineId: activeActLineId ?? undefined,
				limit: 5,
			});
			status = `Found ${locationQueryResults.length} result(s) by location.`;
		} catch (err) {
			status = err instanceof Error ? err.message : 'Search by location failed';
			locationQueryResults = [];
		} finally {
			isLoading = false;
		}
	}

	async function handleReset() {
		if (!embeddingConfig) return;
		confirmDialog = {
			title: 'Reset All Memories',
			message: 'Delete all memories and locations? This cannot be undone.',
			onConfirm: doReset,
		};
	}

	async function doReset() {
		isLoading = true;
		try {
			const memory = new Memory(embeddingConfig);
			await memory.reset();
			memories = [];
			locations = [];
			searchResults = [];
			locationSearchResults = [];
			locationQueryResults = [];
			status = 'All memories deleted.';
		} catch (err) {
			status = err instanceof Error ? err.message : 'Reset failed';
		} finally {
			isLoading = false;
		}
	}

	async function handleDeleteMemory(id: string) {
		if (!embeddingConfig) return;
		isLoading = true;
		try {
			const memory = new Memory(embeddingConfig);
			await memory.delete(id);
			await loadMemories();
			status = 'Memory deleted.';
		} catch (err) {
			status = err instanceof Error ? err.message : 'Delete failed';
		} finally {
			isLoading = false;
		}
	}

	$effect(() => {
		if (embeddingConfig && activeStoryId && settings.memoryEnabled) {
			loadMemories();
		}
	});
</script>

<div class="flex-1 overflow-y-auto p-6">
	<div class="max-w-2xl mx-auto space-y-8">
		<h1 class="h2 font-display">Memory Manager</h1>

		{#if settings.memoryEnabled}
			<section class="card p-4 space-y-2">
				<div class="flex items-center gap-2">
					<span class="text-xs text-surface-500 w-32 shrink-0">Story</span>
					<span class="text-sm font-medium">{activeStory?.name ?? 'None selected'}</span>
				</div>
				<div class="flex items-center gap-2">
					<span class="text-xs text-surface-500 w-32 shrink-0">Act</span>
					<span class="text-sm font-medium">{activeAct?.name ?? 'None selected'}</span>
				</div>
				<div class="flex items-center gap-2">
					<span class="text-xs text-surface-500 w-32 shrink-0">Act Line</span>
					<span class="text-sm font-medium">{activeActLine?.name ?? 'None selected'}</span>
				</div>
				<div class="border-t border-surface-200-700 my-2"></div>
				<div class="flex items-center gap-2">
					<span class="text-xs text-surface-500 w-32 shrink-0">Memory Provider</span>
					<span class="text-sm font-medium">{providerLabel(memoryConfig, 'memory')}</span>
				</div>
				<div class="flex items-center gap-2">
					<span class="text-xs text-surface-500 w-32 shrink-0">Embedding Provider</span>
					<span class="text-sm font-medium">{providerLabel(embeddingConfig, 'embedding')}</span>
				</div>
			</section>
		{/if}

		{#if !settings.memoryEnabled}
			<p class="text-warning-700-300">Memory is currently disabled in Settings.</p>
		{:else if !activeStoryId}
			<p class="text-error-700-300">No story selected. Select a story in the sidebar.</p>
		{:else if !embeddingConfig}
			<p class="text-error-700-300">Please configure an embedding provider in Settings first.</p>
		{/if}

		<!-- Generation Tools -->
		{#if settings.memoryEnabled && activeStoryId}
			<section class="card p-6 space-y-4">
				<h2 class="h4">Generation Tools</h2>

				<div class="flex flex-wrap gap-2">
					<button
						class="btn preset-filled"
						type="button"
						onclick={handleGenerateActCard}
						disabled={!activeActLineId || isGeneratingAct || getIsRegenerating()}
					>
						{#if isGeneratingAct}
							Generating...
						{:else}
							Generate Act Card
						{/if}
					</button>
					<button
						class="btn preset-outlined"
						type="button"
						onclick={() => goto('/generate-character-cards')}
						disabled={!activeActLineId || isGeneratingAct || getIsRegenerating()}
					>
						Generate Character Cards
					</button>
					<button
						class="btn preset-tonal"
						type="button"
						onclick={handleRegenerateMemories}
						disabled={!activeActLineId || isGeneratingAct || getIsRegenerating()}
					>
						{#if getIsRegenerating()}
							Regenerating...
						{:else}
							Regenerate Memories
						{/if}
					</button>
				</div>

				{#if consoleOutput}
					<div class="bg-surface-900-100 text-surface-100-900 rounded-lg p-4 font-mono text-xs h-64 overflow-y-auto">
						<pre bind:this={consoleRef} class="whitespace-pre-wrap break-words">{consoleOutput}</pre>
					</div>

					<details>
						<summary class="text-sm font-medium cursor-pointer text-surface-500">Full Log</summary>
						<div class="mt-2 space-y-1 max-h-64 overflow-y-auto">
							{#each progressUpdates as update}
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
		<section class="card p-6 space-y-4">
			<h2 class="h4">Search by Location</h2>
			<input class="input w-full" type="text" placeholder="Query..." bind:value={locationQuery} disabled={isLoading || !activeStoryId} />
			<input
				class="input w-full"
				type="text"
				placeholder="Location..."
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
					Search
				</button>
			</div>

			{#if locationQueryResults.length > 0}
				<div class="space-y-2 mt-4">
					<p class="text-sm font-medium text-surface-700-300">Results</p>
					{#each locationQueryResults as result (result.id)}
						<div class="p-3 rounded-[var(--radius-base)] bg-surface-100-900">
							<p class="text-sm">{result.memory}</p>
							<p class="text-xs text-surface-500">
								Character: {result.characterCanonicalName} · Location: {result.location} · Distance: {result.score?.toFixed(4) ?? 'N/A'}
							</p>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Search Memories -->
		<section class="card p-6 space-y-4">
			<h2 class="h4">Search Memories</h2>
			<input class="input w-full" type="text" placeholder="Query..." bind:value={searchQuery} disabled={isLoading || !activeStoryId} />
			<div class="flex gap-2">
				<button
					class="btn preset-filled"
					type="button"
					onclick={handleSearch}
					disabled={isLoading || !searchQuery.trim() || !activeStoryId}
				>
					Search
				</button>
			</div>

			{#if searchResults.length > 0}
				<div class="space-y-2 mt-4">
					<p class="text-sm font-medium text-surface-700-300">Results</p>
					{#each searchResults as result (result.id)}
						<div class="p-3 rounded-[var(--radius-base)] bg-surface-100-900">
							<p class="text-sm">{result.memory}</p>
							<p class="text-xs text-surface-500">
								Character: {result.characterCanonicalName} · Location: {result.location} · Distance: {result.score?.toFixed(4) ?? 'N/A'}
							</p>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Search Locations -->
		<section class="card p-6 space-y-4">
			<h2 class="h4">Search Locations</h2>
			<input
				class="input w-full"
				type="text"
				placeholder="Query..."
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
					Search
				</button>
			</div>

			{#if locationSearchResults.length > 0}
				<div class="space-y-2 mt-4">
					<p class="text-sm font-medium text-surface-700-300">Results</p>
					{#each locationSearchResults as result (result.id)}
						<div class="p-3 rounded-[var(--radius-base)] bg-surface-100-900">
							<p class="text-sm">{result.location}</p>
							<p class="text-xs text-surface-500">Distance: {result.score?.toFixed(4) ?? 'N/A'}</p>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- All Memories -->
		<section class="card p-6 space-y-4">
			<div class="flex items-center justify-between">
				<h2 class="h4">All Memories ({memories.length})</h2>
			</div>

			{#if memories.length === 0}
				<p class="text-sm text-surface-500">No memories stored yet.</p>
			{:else}
				<div class="space-y-2">
					{#each memories as memory (memory.id)}
						<div class="p-3 rounded-[var(--radius-base)] bg-surface-100-900 flex justify-between items-start">
							<div>
								<p class="text-sm">{memory.memory}</p>
								<p class="text-xs text-surface-500">
									{memory.characterCanonicalName} · {memory.location} · {memory.createdAt}
								</p>
							</div>
							<button
								class="btn preset-tonal text-xs px-2 py-1 text-error-700-300"
								type="button"
								onclick={() => handleDeleteMemory(memory.id)}
								disabled={isLoading}
							>
								Delete
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- All Locations -->
		<section class="card p-6 space-y-4">
			<div class="flex items-center justify-between">
				<h2 class="h4">All Locations ({locations.length})</h2>
			</div>

			{#if locations.length === 0}
				<p class="text-sm text-surface-500">No locations stored yet.</p>
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

		<!-- Reset -->
		<section class="card p-6 space-y-4">
			<h2 class="h4">Danger Zone</h2>
			<button class="btn preset-tonal text-error-700-300" type="button" onclick={handleReset} disabled={isLoading}>
				Reset All Memories
			</button>
		</section>

		{#if status}
			<p class="text-sm text-surface-500">{status}</p>
		{/if}
	</div>
</div>

<!-- Confirmation Dialog -->
{#if confirmDialog}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		role="dialog"
		aria-modal="true"
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		onclick={() => (confirmDialog = null)}
		onkeydown={(e) => e.key === 'Escape' && (confirmDialog = null)}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="bg-surface-100-900 border border-surface-200-800 rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<h3 class="text-lg font-semibold text-surface-900-100 mb-2">
				{confirmDialog.title}
			</h3>
			<p class="text-sm text-surface-600-400 mb-5">
				{confirmDialog.message}
			</p>
			<div class="flex justify-end gap-3">
				<button class="btn preset-tonal" type="button" onclick={() => (confirmDialog = null)}> Cancel </button>
				<button
					class="btn variant-filled"
					type="button"
					onclick={() => {
						const handler = confirmDialog!.onConfirm;
						confirmDialog = null;
						handler();
					}}
				>
					Confirm
				</button>
			</div>
		</div>
	</div>
{/if}
