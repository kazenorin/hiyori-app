<script lang="ts">
	import { Memory, type MemoryItem, type LocationItem } from '$lib/memory/memory';
	import { getMemoryProviderConfig, settings } from '$lib/stores/settings.svelte';
	import { getActiveStoryId } from '$lib/stores/stories.svelte';

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

	const providerConfig = $derived(getMemoryProviderConfig());
	const activeStoryId = $derived(getActiveStoryId());

	async function loadMemories() {
		if (!providerConfig || !activeStoryId) {
			status = !activeStoryId ? 'No story selected.' : 'No provider configured.';
			return;
		}
		const memory = new Memory(providerConfig);
		memories = await memory.getAll({ storyId: activeStoryId });
		locations = await memory.getAllLocations({ storyId: activeStoryId });
	}

	async function handleAddMemory() {
		if (!addText.trim() || !providerConfig || !activeStoryId) return;
		isLoading = true;
		status = 'Embedding and saving...';
		try {
			const memory = new Memory(providerConfig);
			await memory.add(
				activeStoryId,
				'test-line',
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
		if (!searchQuery.trim() || !providerConfig || !activeStoryId) return;
		isLoading = true;
		status = 'Searching memories...';
		try {
			const memory = new Memory(providerConfig);
			searchResults = await memory.search(searchQuery.trim(), { storyId: activeStoryId, limit: 5 });
			status = `Found ${searchResults.length} result(s).`;
		} catch (err) {
			status = err instanceof Error ? err.message : 'Search failed';
			searchResults = [];
		} finally {
			isLoading = false;
		}
	}

	async function handleLocationSearch() {
		if (!locationSearchQuery.trim() || !providerConfig || !activeStoryId) return;
		isLoading = true;
		status = 'Searching locations...';
		try {
			const memory = new Memory(providerConfig);
			locationSearchResults = await memory.searchLocations(locationSearchQuery.trim(), { storyId: activeStoryId, limit: 5 });
			status = `Found ${locationSearchResults.length} location(s).`;
		} catch (err) {
			status = err instanceof Error ? err.message : 'Location search failed';
			locationSearchResults = [];
		} finally {
			isLoading = false;
		}
	}

	async function handleReset() {
		if (!providerConfig) return;
		const confirmed = confirm('Delete all memories and locations for this story?');
		if (!confirmed) return;
		isLoading = true;
		try {
			const memory = new Memory(providerConfig);
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
		if (!providerConfig) return;
		isLoading = true;
		try {
			const memory = new Memory(providerConfig);
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
		if (providerConfig && activeStoryId && settings.memoryEnabled) {
			loadMemories();
		}
	});
</script>

<div class="flex-1 overflow-y-auto p-6">
	<div class="max-w-2xl mx-auto space-y-8">
		<h1 class="h2 font-display">Memory Test</h1>

		{#if !settings.memoryEnabled}
			<p class="text-warning-700-300">Memory is currently disabled in Settings.</p>
		{:else if !activeStoryId}
			<p class="text-error-700-300">No story selected. Select a story to test memory.</p>
		{:else if !providerConfig}
			<p class="text-error-700-300">Please configure a memory provider in Settings first.</p>
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