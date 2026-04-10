<script lang="ts">
	import './+layout.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { initializeApp } from '$lib/app/init.svelte';
	import { log } from '$lib/logging/logger';
	import {
		getStories,
		getActs,
		getActLines,
		getActiveStoryId,
		getActiveActId,
		getActiveActLineId,
		getIsLoading,
		selectStory,
		selectAct,
		selectActLine,
		createStory,
		createAct,
		createActLine,
		deleteStory,
		deleteAct,
		deleteActLine
	} from '$lib/stores/stories.svelte';
	import {
		getMessages,
		getIsStreaming,
		loadActLineMessages,
		clearMessages
	} from '$lib/ai/chat.svelte';
	import {
		enterWorldBuilderMode,
		exitWorldBuilderMode,
		getIsActive as getIsWorldBuilderActive
	} from '$lib/ai/world-builder.svelte';

	let { children } = $props();
	let appError = $state<string | null>(null);
	let initStatus = $state('Starting...');
	let appReady = $state(false);
	let newActName = $state('');
	let newActLineName = $state('');
	let showNewAct = $state(false);
	let showNewActLine = $state(false);

	onMount(async () => {
		try {
			await log.info('init', 'Starting app initialization...');
			await initializeApp((status) => (initStatus = status));
			await log.info('init', 'App initialized successfully');
			initStatus = 'Loading messages...';
			// Load messages for the restored act line
			const lineId = getActiveActLineId();
			if (lineId) {
				await loadActLineMessages(lineId);
			}
			appReady = true;
		} catch (err) {
			await log.error('init', 'Failed', err);
			appError = err instanceof Error ? err.message : String(err);
		}
	});

	async function handleSelectStory(id: string) {
		if (getIsWorldBuilderActive()) exitWorldBuilderMode();
		await selectStory(id);
		clearMessages();
		goto('/');
	}

	async function handleSelectAct(id: string) {
		if (getIsWorldBuilderActive()) exitWorldBuilderMode();
		await selectAct(id);
		clearMessages();
		goto('/');
	}

	async function handleSelectActLine(id: string) {
		if (getIsWorldBuilderActive()) exitWorldBuilderMode();
		await selectActLine(id);
		await loadActLineMessages(id);
		goto('/');
	}

	async function handleNewStory() {
		exitWorldBuilderMode();
		clearMessages();
		await enterWorldBuilderMode();
		goto('/');
	}


	async function handleCreateAct() {
		const name = newActName.trim();
		const storyId = getActiveStoryId();
		if (!name || !storyId) return;
		await createAct(storyId, name);
		newActName = '';
		showNewAct = false;
	}

	async function handleCreateActLine() {
		const name = newActLineName.trim();
		const actId = getActiveActId();
		if (!name || !actId) return;
		const line = await createActLine(actId, name);
		newActLineName = '';
		showNewActLine = false;
		await handleSelectActLine(line.id);
	}

	async function handleDeleteStory(id: string) {
		await deleteStory(id);
		clearMessages();
	}

	async function handleDeleteAct(id: string) {
		await deleteAct(id);
		clearMessages();
	}

	async function handleDeleteActLine(id: string) {
		await deleteActLine(id);
		clearMessages();
	}
</script>

{#if !appReady}
	<div class="flex h-screen items-center justify-center bg-surface-50-950">
		{#if appError}
			<div class="text-center space-y-3">
				<p class="text-error-500">{appError}</p>
			</div>
		{:else}
			<div class="text-center space-y-2">
				<div class="text-surface-500 animate-pulse">Loading...</div>
				<div class="text-xs text-surface-600">{initStatus}</div>
			</div>
		{/if}
	</div>
{:else}
	<div class="flex h-screen overflow-hidden bg-surface-50-950">
		<!-- Sidebar -->
		<aside class="w-72 border-r border-surface-200-800 flex flex-col">
			<nav class="flex-1 overflow-y-auto p-2 pt-4 space-y-1">
				{#each getStories() as story (story.id)}
					<div class="space-y-0.5">
						<!-- Story header -->
						<div
							class="flex items-center justify-between p-3 rounded-[var(--radius-base)] transition-colors duration-150 cursor-pointer {getActiveStoryId() === story.id ? 'bg-surface-200-800' : 'hover:bg-surface-200-800'}"
							onclick={() => handleSelectStory(story.id)}
						>
							<span class="text-sm font-medium truncate flex-1">{story.name}</span>
							<button
								class="text-surface-500 hover:text-error-500 ml-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
								type="button"
								onclick={(e) => { e.stopPropagation(); handleDeleteStory(story.id); }}
								title="Delete story"
							>&times;</button
							>
						</div>

						<!-- Acts (only show for active story) -->
						{#if getActiveStoryId() === story.id}
							{#each getActs() as act (act.id)}
								<div class="ml-3 space-y-0.5">
									<div
										class="flex items-center justify-between p-2 pl-4 rounded-[var(--radius-base)] transition-colors duration-150 cursor-pointer text-sm {getActiveActId() === act.id ? 'bg-surface-200-800' : 'hover:bg-surface-200-800'}"
										onclick={() => handleSelectAct(act.id)}
									>
										<span class="truncate flex-1 text-surface-700-300">Act {act.actNumber}: {act.name}</span>
										<button
											class="text-surface-500 hover:text-error-500 ml-2 text-xs shrink-0"
											type="button"
											onclick={(e) => { e.stopPropagation(); handleDeleteAct(act.id); }}
											title="Delete act"
										>&times;</button
										>
									</div>

									<!-- Act Lines -->
									{#if getActiveActId() === act.id}
										{#each getActLines() as line (line.id)}
											<div
												class="flex items-center justify-between p-2 pl-8 rounded-[var(--radius-base)] transition-colors duration-150 cursor-pointer text-xs {getActiveActLineId() === line.id ? 'bg-primary-100-900 text-primary-700-300' : 'hover:bg-surface-200-800 text-surface-500'}"
												onclick={() => handleSelectActLine(line.id)}
											>
												<span class="truncate flex-1">{line.name}</span>
												<button
													class="text-surface-500 hover:text-error-500 ml-2 text-xs shrink-0"
													type="button"
													onclick={(e) => { e.stopPropagation(); handleDeleteActLine(line.id); }}
													title="Delete line"
												>&times;</button
												>
											</div>
										{/each}

										<!-- Add act line button -->
										{#if showNewActLine}
											<div class="pl-8 p-1">
												<div class="flex gap-1">
													<input
														class="input text-xs flex-1"
														placeholder="Line name"
														bind:value={newActLineName}
														onkeydown={(e) => e.key === 'Enter' && handleCreateActLine()}
													/>
													<button class="text-xs text-primary-500" type="button" onclick={handleCreateActLine}>+</button>
												</div>
											</div>
										{:else}
											<button
												class="p-2 pl-8 text-xs text-surface-500 hover:text-surface-700-300 transition-colors"
												type="button"
												onclick={() => (showNewActLine = true)}
											>
												+ New Line
											</button>
										{/if}
									{/if}
								</div>
							{/each}

							<!-- Add act button -->
							{#if showNewAct}
								<div class="ml-3 p-1">
									<div class="flex gap-1">
										<input
											class="input text-xs flex-1"
											placeholder="Act name"
											bind:value={newActName}
											onkeydown={(e) => e.key === 'Enter' && handleCreateAct()}
										/>
										<button class="text-xs text-primary-500" type="button" onclick={handleCreateAct}>+</button>
									</div>
								</div>
							{:else}
								<button
									class="ml-3 p-2 pl-4 text-xs text-surface-500 hover:text-surface-700-300 transition-colors"
									type="button"
									onclick={() => (showNewAct = true)}
								>
									+ New Act
								</button>
							{/if}
						{/if}
					</div>
				{/each}

				<!-- Add story button -->
				<button
					class="w-full p-3 rounded-[var(--radius-base)] hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500"
					type="button"
					onclick={handleNewStory}
				>
					+ New Story
				</button>
			</nav>

			<!-- Sidebar footer -->
			<div class="p-3 border-t border-surface-200-800 flex flex-col gap-1">
				<a
					href="/"
					class="flex items-center gap-2 p-2 rounded-[var(--radius-base)] hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500"
				>
					Chat
				</a>
				<a
					href="/settings"
					class="flex items-center gap-2 p-2 rounded-[var(--radius-base)] hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500"
				>
					Settings
				</a>
			</div>
		</aside>

		<!-- Main content -->
		<main class="flex-1 flex flex-col min-w-0">
			{@render children()}
		</main>
	</div>
{/if}