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
		deleteActLine,
		renameStory,
		renameAct,
		renameActLine,
	} from '$lib/stores/stories.svelte';
	import { getMessages, getIsStreaming, loadActLineMessages, clearMessages } from '$lib/ai/chat.svelte';
	import { enterWorldBuilderMode, exitWorldBuilderMode, getIsActive as getIsWorldBuilderActive } from '$lib/ai/world-builder.svelte';
	import { getSettings, updateSettings } from '$lib/stores/settings.svelte';

	let { children } = $props();
	let appError = $state<string | null>(null);
	let initStatus = $state('Starting...');
	let appReady = $state(false);
	let newActName = $state('');
	let newActLineName = $state('');
	let showNewAct = $state(false);
	let showNewActLine = $state(false);

	// Inline rename state
	let editingId = $state<string | null>(null);
	let editingType = $state<'story' | 'act' | 'line' | null>(null);
	let editingName = $state('');
	let renameSubmitting = $state(false);

	// Delete confirmation state
	type DeleteTarget = { type: 'story' | 'act' | 'line'; id: string; name: string };
	let confirmDelete = $state<DeleteTarget | null>(null);
	let cancelButton: HTMLButtonElement | null = $state(null);

	// New story mode selection
	let showNewStoryModal = $state(false);

	// Font size slider state
	let fontSizeSlider = $state(getSettings().fontSize);
	$effect(() => {
		fontSizeSlider = getSettings().fontSize;
	});

	function handleFontSizeChange(e: Event) {
		const value = parseFloat((e.currentTarget as HTMLInputElement).value);
		updateSettings({ fontSize: value });
	}

	// Ctrl+scroll to adjust text size
	$effect(() => {
		function handleWheel(e: WheelEvent) {
			if (!e.ctrlKey) return;
			e.preventDefault();
			const current = getSettings().fontSize;
			const delta = e.deltaY > 0 ? -0.05 : 0.05;
			const next = Math.min(1.5, Math.max(0.7, Math.round((current + delta) * 100) / 100));
			if (next !== current) {
				updateSettings({ fontSize: next });
			}
		}
		window.addEventListener('wheel', handleWheel, { passive: false });
		return () => window.removeEventListener('wheel', handleWheel);
	});

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
		showNewStoryModal = true;
	}

	function handleStartWorldBuilder() {
		showNewStoryModal = false;
		exitWorldBuilderMode();
		clearMessages();
		enterWorldBuilderMode();
		goto('/');
	}

	function handleStartImportWorld() {
		showNewStoryModal = false;
		goto('/import-world');
	}

	function cancelNewStory() {
		showNewStoryModal = false;
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

	// === Rename handlers ===

	function startRename(type: 'story' | 'act' | 'line', id: string, currentName: string) {
		editingId = id;
		editingType = type;
		editingName = currentName;
	}

	function cancelRename() {
		editingId = null;
		editingType = null;
		editingName = '';
		renameSubmitting = false;
	}

	async function submitRename() {
		if (renameSubmitting) return;
		renameSubmitting = true;
		const name = editingName.trim();
		if (!name || !editingId || !editingType) {
			cancelRename();
			return;
		}
		try {
			if (editingType === 'story') await renameStory(editingId, name);
			else if (editingType === 'act') await renameAct(editingId, name);
			else if (editingType === 'line') await renameActLine(editingId, name);
		} finally {
			cancelRename();
		}
	}

	// === Delete handlers ===

	function requestDeleteStory(id: string, name: string) {
		confirmDelete = { type: 'story', id, name };
	}

	function requestDeleteAct(id: string, name: string) {
		confirmDelete = { type: 'act', id, name };
	}

	function requestDeleteActLine(id: string, name: string) {
		confirmDelete = { type: 'line', id, name };
	}

	function cancelDelete() {
		confirmDelete = null;
	}

	async function confirmDeleteAction(removeFolder: boolean = false) {
		if (!confirmDelete) return;
		const { type, id } = confirmDelete;
		confirmDelete = null;

		try {
			if (type === 'story') {
				await deleteStory(id, removeFolder);
				clearMessages();
			} else if (type === 'act') {
				await deleteAct(id);
				clearMessages();
			} else if (type === 'line') {
				await deleteActLine(id);
				clearMessages();
			}
		} catch (err) {
			await log.error('delete', 'Failed to delete', err);
		}
	}

	$effect(() => {
		if (confirmDelete && cancelButton) {
			cancelButton.focus();
		}
	});
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
							class="group flex items-center justify-between p-3 rounded-[var(--radius-base)] transition-colors duration-150 cursor-pointer {getActiveStoryId() ===
							story.id
								? 'bg-surface-200-800'
								: 'hover:bg-surface-200-800'}"
							onclick={() => handleSelectStory(story.id)}
						>
							{#if editingId === story.id && editingType === 'story'}
								<input
									autofocus
									maxlength="200"
									class="input text-sm flex-1"
									bind:value={editingName}
									onkeydown={(e) => {
										if (e.key === 'Enter') {
											e.preventDefault();
											submitRename();
										}
										if (e.key === 'Escape') cancelRename();
									}}
									onblur={() => {
										if (!renameSubmitting) submitRename();
									}}
									onclick={(e) => e.stopPropagation()}
									type="text"
								/>
							{:else}
								<span class="text-sm font-medium truncate flex-1">{story.name}</span>
								<button
									class="text-surface-500 hover:text-surface-700-300 ml-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
									type="button"
									onclick={(e) => {
										e.stopPropagation();
										startRename('story', story.id, story.name);
									}}
									title="Rename story">&#9998;</button
								>
							{/if}
							<button
								class="text-surface-500 hover:text-error-500 ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
								type="button"
								onclick={(e) => {
									e.stopPropagation();
									requestDeleteStory(story.id, story.name);
								}}
								title="Delete story">&times;</button
							>
						</div>

						<!-- Acts (only show for active story) -->
						{#if getActiveStoryId() === story.id}
							{#each getActs() as act (act.id)}
								<div class="ml-3 space-y-0.5">
									<div
										class="group flex items-center justify-between p-2 pl-4 rounded-[var(--radius-base)] transition-colors duration-150 cursor-pointer text-sm {getActiveActId() ===
										act.id
											? 'bg-surface-200-800'
											: 'hover:bg-surface-200-800'}"
										onclick={() => handleSelectAct(act.id)}
									>
										{#if editingId === act.id && editingType === 'act'}
											<input
												autofocus
												maxlength="200"
												class="input text-xs flex-1"
												bind:value={editingName}
												onkeydown={(e) => {
													if (e.key === 'Enter') {
														e.preventDefault();
														submitRename();
													}
													if (e.key === 'Escape') cancelRename();
												}}
												onblur={() => {
													if (!renameSubmitting) submitRename();
												}}
												onclick={(e) => e.stopPropagation()}
												type="text"
											/>
										{:else}
											<span class="truncate flex-1 text-surface-700-300">Act {act.actNumber}: {act.name}</span>
											<button
												class="text-surface-500 hover:text-surface-700-300 ml-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
												type="button"
												onclick={(e) => {
													e.stopPropagation();
													startRename('act', act.id, act.name);
												}}
												title="Rename act">&#9998;</button
											>
										{/if}
										<button
											class="text-surface-500 hover:text-error-500 ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
											type="button"
											onclick={(e) => {
												e.stopPropagation();
												requestDeleteAct(act.id, act.name);
											}}
											title="Delete act">&times;</button
										>
									</div>

									<!-- Act Lines -->
									{#if getActiveActId() === act.id}
										{#each getActLines() as line (line.id)}
											<div
												class="group flex items-center justify-between p-2 pl-8 rounded-[var(--radius-base)] transition-colors duration-150 cursor-pointer text-xs {getActiveActLineId() ===
												line.id
													? 'bg-primary-100-900 text-primary-700-300'
													: 'hover:bg-surface-200-800 text-surface-500'}"
												onclick={() => handleSelectActLine(line.id)}
											>
												{#if editingId === line.id && editingType === 'line'}
													<input
														autofocus
														maxlength="200"
														class="input text-xs flex-1"
														bind:value={editingName}
														onkeydown={(e) => {
															if (e.key === 'Enter') {
																e.preventDefault();
																submitRename();
															}
															if (e.key === 'Escape') cancelRename();
														}}
														onblur={() => {
															if (!renameSubmitting) submitRename();
														}}
														onclick={(e) => e.stopPropagation()}
														type="text"
													/>
												{:else}
													<span class="truncate flex-1">{line.name}</span>
													<button
														class="text-surface-500 hover:text-surface-700-300 ml-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
														type="button"
														onclick={(e) => {
															e.stopPropagation();
															startRename('line', line.id, line.name);
														}}
														title="Rename line">&#9998;</button
													>
												{/if}
												<button
													class="text-surface-500 hover:text-error-500 ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
													type="button"
													onclick={(e) => {
														e.stopPropagation();
														requestDeleteActLine(line.id, line.name);
													}}
													title="Delete line">&times;</button
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
				<label class="flex items-center gap-2 px-2 py-1 text-xs text-surface-500">
					<span class="shrink-0 font-medium" style="font-size: 0.65rem;">Aa</span>
					<input
						class="flex-1 cursor-pointer"
						type="range"
						min="0.7"
						max="1.5"
						step="0.05"
						value={fontSizeSlider}
						oninput={handleFontSizeChange}
					/>
					<span class="shrink-0 w-8 text-right tabular-nums">{(fontSizeSlider * 100).toFixed(0)}%</span>
				</label>
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
				<a
					href="/memory-manager"
					class="flex items-center gap-2 p-2 rounded-[var(--radius-base)] hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500"
				>
					Memory Manager
				</a>
			</div>
		</aside>

		<!-- Main content -->
		<main class="flex-1 flex flex-col min-w-0">
			{@render children()}
		</main>
	</div>

	<!-- Delete Confirmation Modal -->
	{#if confirmDelete}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="delete-dialog-title"
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
			onclick={cancelDelete}
			onkeydown={(e) => e.key === 'Escape' && cancelDelete()}
		>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="bg-surface-100-900 border border-surface-200-800 rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => e.stopPropagation()}
			>
				<h3 id="delete-dialog-title" class="text-lg font-semibold text-surface-900-100 mb-2">
					Delete {confirmDelete.type}?
				</h3>
				<p class="text-sm text-surface-600-400 mb-5">
					{#if confirmDelete.type === 'story'}
						Are you sure you want to delete <strong>{confirmDelete.name}</strong>? All acts and lines within this story will also be
						removed.
					{:else if confirmDelete.type === 'act'}
						Are you sure you want to delete <strong>{confirmDelete.name}</strong>? All lines within this act will also be removed.
					{:else}
						Are you sure you want to delete <strong>{confirmDelete.name}</strong>?
					{/if}
				</p>
				{#if confirmDelete.type === 'story'}
					<div class="flex flex-col gap-2">
						<button
							class="w-full px-4 py-2 rounded-lg bg-error-500 hover:bg-error-600 text-white text-sm font-medium transition-colors"
							type="button"
							onclick={() => confirmDeleteAction(false)}
						>
							Delete (keep folder)
						</button>
						<button
							class="w-full px-4 py-2 rounded-lg bg-error-700 hover:bg-error-800 text-white text-sm font-medium transition-colors"
							type="button"
							onclick={() => confirmDeleteAction(true)}
						>
							Delete with folder
						</button>
						<button
							bind:this={cancelButton}
							class="w-full px-4 py-2 rounded-lg bg-surface-200-800 hover:bg-surface-300-700 text-surface-700-300 text-sm transition-colors"
							type="button"
							onclick={cancelDelete}
						>
							Cancel
						</button>
					</div>
				{:else}
					<div class="flex gap-2">
						<button
							bind:this={cancelButton}
							class="flex-1 px-4 py-2 rounded-lg bg-surface-200-800 hover:bg-surface-300-700 text-surface-700-300 text-sm transition-colors"
							type="button"
							onclick={cancelDelete}
						>
							Cancel
						</button>
						<button
							class="flex-1 px-4 py-2 rounded-lg bg-error-500 hover:bg-error-600 text-white text-sm font-medium transition-colors"
							type="button"
							onclick={() => confirmDeleteAction()}
						>
							Delete
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- New Story Modal -->
	{#if showNewStoryModal}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="new-story-dialog-title"
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
			onclick={cancelNewStory}
			onkeydown={(e) => e.key === 'Escape' && cancelNewStory()}
		>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="bg-surface-100-900 border border-surface-200-800 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => e.stopPropagation()}
			>
				<h3 id="new-story-dialog-title" class="text-lg font-semibold text-surface-900-100 mb-4">Create New Story</h3>
				<div class="flex flex-col gap-3">
					<button
						class="w-full text-left p-4 rounded-lg border border-surface-200-800 hover:bg-surface-200-800 transition-colors duration-150"
						type="button"
						onclick={handleStartWorldBuilder}
					>
						<div class="font-medium text-surface-900-100 mb-1">World Builder</div>
						<div class="text-sm text-surface-600-400">Guided interview to create a world from scratch with AI assistance.</div>
					</button>
					<button
						class="w-full text-left p-4 rounded-lg border border-surface-200-800 hover:bg-surface-200-800 transition-colors duration-150"
						type="button"
						onclick={handleStartImportWorld}
					>
						<div class="font-medium text-surface-900-100 mb-1">Import World</div>
						<div class="text-sm text-surface-600-400">Bring an existing world document and start playing immediately.</div>
					</button>
				</div>
				<button
					class="w-full mt-4 px-4 py-2 rounded-lg bg-surface-200-800 hover:bg-surface-300-700 text-surface-700-300 text-sm transition-colors"
					type="button"
					onclick={cancelNewStory}
				>
					Cancel
				</button>
			</div>
		</div>
	{/if}
{/if}
