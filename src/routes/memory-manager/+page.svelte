<script lang="ts">
	import { Memory, type MemoryItem, type LocationItem } from '$lib/memory/memory';
	import { getEmbeddingProviderConfig, getMemoryProviderConfig, settings } from '$lib/stores/settings.svelte';
	import { getActiveStory, getActiveAct, getActiveActLine, getActiveStoryId, getActiveActLineId } from '$lib/stores/stories.svelte';

	let memories = $state<MemoryItem[]>([]);
	let locations = $state<LocationItem[]>([]);
	let addText = $state('');
	let addCharacter = $state('');
	let addLocationText = $state('');
	let searchQuery = $state('');
	let searchResults = $state<MemoryItem[]>([]);
	let locationSearchQuery = $state('');
	let locationSearchResults = $state<LocationItem[]>([]);
	let status = $state('');
	let isLoading = $state(false);

	const embeddingConfig = $derived(getEmbeddingProviderConfig());
	const memoryConfig = $derived(getMemoryProviderConfig());
	const activeStory = $derived(getActiveStory());
	const activeAct = $derived(getActiveAct());
	const activeActLine = $derived(getActiveActLine());
	const activeStoryId = $derived(getActiveStoryId());
	const activeActLineId = $derived(getActiveActLineId());

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

	async function handleAddMemory() {
		if (!addText.trim() || !embeddingConfig || !activeStoryId) return;
		isLoading = true;
		status = 'Embedding and saving...';
		try {
			const memory = new Memory(embeddingConfig);
			await memory.add(
				activeStoryId,
				activeActLineId ?? 'test-line',
				addCharacter.trim() || 'unknown',
				addLocationText.trim() || 'unknown',
				[addText.trim()]
			);
			addText = '';
			addCharacter = '';
			addLocationText = '';
			await loadMemories();
			status = 'Saved.';
		} catch (err) {
			status = err instanceof Error ? err.message : 'Failed to save';
		} finally {
			isLoading = false;
		}
	}

	async function handleSearch() {
		if (!searchQuery.trim() || !embeddingConfig || !activeStoryId) return;
		isLoading = true;
		status = 'Searching memories...';
		try {
			const memory = new Memory(embeddingConfig);
			searchResults = await memory.search(searchQuery.trim(), { storyId: activeStoryId, actLineId: activeActLineId ?? undefined, limit: 5 });
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
			locationSearchResults = await memory.searchLocations(locationSearchQuery.trim(), { storyId: activeStoryId, actLineId: activeActLineId ?? undefined, limit: 5 });
			status = `Found ${locationSearchResults.length} location(s).`;
		} catch (err) {
			status = err instanceof Error ? err.message : 'Location search failed';
			locationSearchResults = [];
		} finally {
			isLoading = false;
		}
	}

	async function handleReset() {
		if (!embeddingConfig) return;
		const confirmed = confirm('Delete all memories and locations?');
		if (!confirmed) return;
		isLoading = true;
		try {
			const memory = new Memory(embeddingConfig);
			await memory.reset();
			memories = [];
			locations = [];
			searchResults = [];
			locationSearchResults = [];
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

		<!-- Add Memory -->
		<section class="card p-6 space-y-4">
			<h2 class="h4">Add Memory</h2>
			<textarea
				class="input w-full h-24"
				placeholder="Enter text to remember..."
				bind:value={addText}
				disabled={isLoading || !activeStoryId}
			></textarea>
			<input
				class="input w-full"
				type="text"
				placeholder="Character name (optional)"
				bind:value={addCharacter}
				disabled={isLoading || !activeStoryId}
			/>
			<input
				class="input w-full"
				type="text"
				placeholder="Location (optional)"
				bind:value={addLocationText}
				disabled={isLoading || !activeStoryId}
			/>
			<div class="flex gap-2">
				<button
					class="btn preset-filled"
					type="button"
					onclick={handleAddMemory}
					disabled={isLoading || !addText.trim() || !activeStoryId}
				>
					Save Memory
				</button>
			</div>
		</section>

		<!-- Search Memories -->
		<section class="card p-6 space-y-4">
			<h2 class="h4">Search Memories</h2>
			<input
				class="input w-full"
				type="text"
				placeholder="Query..."
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