<script lang="ts">
	import './+layout.css';
	import { onMount } from 'svelte';
	import { clamp } from 'lodash-es';
	import { goto, beforeNavigate } from '$app/navigation';
	import { initializeApp } from '$lib/app/init.svelte';
	import { log } from '$lib/logging/logger';
	import { registerSW } from 'virtual:pwa-register';
	import {
		getStories,
		getActs,
		getActLines,
		getActiveStoryId,
		getActiveStoryName,
		getActiveActId,
		getActiveActLineId,
		getActPlotGenerationPhase,
		selectStory,
		selectAct,
		selectActLine,
		createActLine,
		deleteStory,
		deleteAct,
		deleteActLine,
		renameStory,
		renameAct,
		renameActLine,
	} from '$lib/stores/stories.svelte';
	import { batchGetActLineEventSummary } from '$lib/db/act-lines';
	import { loadActLineMessages, clearMessages, getActEnded, getStoryConcluded } from '$lib/ai/chat.svelte';
	import {
		enterWorldBuilderMode,
		exitWorldBuilderMode,
		getIsActive as getIsWorldBuilderActive,
	} from '$lib/features/world-builder/world-builder.svelte';
	import { getSettings, updateSettings } from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';
	import type { ActLineEventSummary } from '$lib/db/act-lines';

	import BottomTabBar from '$lib/components/BottomTabBar.svelte';
	import { mobileNav, mobileFeatures } from '$lib/stores/mobile-nav.svelte';

	let { children } = $props();
	let appError = $state<string | null>(null);
	let initStatus = $state('Starting...');
	let appReady = $state(false);
	let sidebarBlocked = $derived(getIsWorldBuilderActive());
	let sidebarOpen = $state(false);
	let newActLineName = $state('');
	let showNewActLine = $state(false);
	let actLineEventSummaries = $state<Map<string, ActLineEventSummary>>(new Map());

	// Mobile detection
	$effect(() => {
		const mql = window.matchMedia('(max-width: 767px)');
		mobileFeatures.isPhone = mql.matches;
		const handler = (e: MediaQueryListEvent) => {
			mobileFeatures.isPhone = e.matches;
			if (!e.matches) {
				mobileNav.activeTab = 'chat';
			}
		};
		mql.addEventListener('change', handler);
		return () => mql.removeEventListener('change', handler);
	});

	// Swipe right from left edge to open sidebar (phone)
	let touchStartX = 0;
	let touchStartY = 0;
	const EDGE_THRESHOLD = 30;
	const SWIPE_MIN_X = 60;
	const SWIPE_MAX_Y = 40;

	function handleTouchStart(e: TouchEvent) {
		touchStartX = e.changedTouches[0].screenX;
		touchStartY = e.changedTouches[0].screenY;
	}

	function handleTouchEnd(e: TouchEvent) {
		if (!mobileFeatures.isPhone) return;
		const x = e.changedTouches[0].screenX;
		const y = e.changedTouches[0].screenY;
		const dx = x - touchStartX;
		const dy = y - touchStartY;

		// Swipe right from left edge → open sidebar
		if (dx > SWIPE_MIN_X && Math.abs(dy) < SWIPE_MAX_Y && touchStartX < EDGE_THRESHOLD && !sidebarOpen) {
			sidebarOpen = true;
		}
		// Swipe left on sidebar to close
		if (dx < -SWIPE_MIN_X && Math.abs(dy) < SWIPE_MAX_Y && sidebarOpen) {
			sidebarOpen = false;
		}
	}
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
	let fontSizeSlider = $derived(getSettings().fontSize);

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
			const next = clamp(Math.round((current + delta) * 100) / 100, 0.7, 1.5);
			if (next !== current) {
				updateSettings({ fontSize: next });
			}
		}
		window.addEventListener('wheel', handleWheel, { passive: false });
		return () => window.removeEventListener('wheel', handleWheel);
	});

	// Fetch event summaries for sidebar badges
	$effect(() => {
		const lines = getActLines();
		getActEnded();
		getStoryConcluded();
		if (lines.length === 0) {
			actLineEventSummaries = new Map();
			return;
		}
		const ids = lines.map((l) => l.id);
		batchGetActLineEventSummary(ids).then((map) => {
			actLineEventSummaries = map;
		});
	});

	// Close sidebar drawer on any navigation (prevents it staying open across pages)
	beforeNavigate(() => {
		sidebarOpen = false;
	});

	onMount(async () => {
		registerSW({ immediate: true });
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
				await deleteActLine(id, removeFolder);
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

	function handleRenameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			submitRename();
		}
		if (e.key === 'Escape') cancelRename();
	}
</script>

{#snippet SidebarNavFooter()}
	<nav class="flex-1 overflow-y-auto p-2 pt-4 space-y-1 relative">
		{#each getStories() as story (story.id)}
			<div class="space-y-0.5">
				<!-- Story header -->
				<div
					class="group flex items-center justify-between p-3 rounded-(--radius-base) transition-colors duration-150 cursor-pointer {getActiveStoryId() ===
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
							onkeydown={handleRenameKeydown}
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
							title={t('sidebar.renameStory')}>&#9998;</button
						>
					{/if}
					<button
						class="text-surface-500 hover:text-error-500 ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
						type="button"
						onclick={(e) => {
							e.stopPropagation();
							requestDeleteStory(story.id, story.name);
						}}
						title={t('sidebar.deleteStory')}>&times;</button
					>
				</div>

				<!-- Acts (only show for active story) -->
				{#if getActiveStoryId() === story.id}
					{#each getActs() as act (act.id)}
						<div class="ml-3 space-y-0.5">
							<div
								class="group flex items-center justify-between p-2 pl-4 rounded-(--radius-base) transition-colors duration-150 cursor-pointer text-sm {getActiveActId() ===
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
										onkeydown={handleRenameKeydown}
										onblur={() => {
											if (!renameSubmitting) submitRename();
										}}
										onclick={(e) => e.stopPropagation()}
										type="text"
									/>
								{:else}
									<span class="truncate flex-1 text-surface-700-300">{t('common.actLabel', { n: act.actNumber })}: {act.name}</span>
									<button
										class="text-surface-500 hover:text-surface-700-300 ml-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
										type="button"
										onclick={(e) => {
											e.stopPropagation();
											startRename('act', act.id, act.name);
										}}
										title={t('sidebar.renameAct')}>&#9998;</button
									>
								{/if}
								{#if getActs().length > 1 && getActs().at(-1)?.id === act.id}
									<button
										class="text-surface-500 hover:text-error-500 ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
										type="button"
										onclick={(e) => {
											e.stopPropagation();
											requestDeleteAct(act.id, act.name);
										}}
										title={t('sidebar.deleteAct')}>&times;</button
									>
								{/if}
							</div>

							<!-- Act Lines -->
							{#if getActiveActId() === act.id}
								{#each getActLines() as line (line.id)}
									<div
										class="group flex items-center justify-between p-2 pl-8 rounded-(--radius-base) transition-colors duration-150 cursor-pointer text-xs {getActiveActLineId() ===
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
												onkeydown={handleRenameKeydown}
												onblur={() => {
													if (!renameSubmitting) submitRename();
												}}
												onclick={(e) => e.stopPropagation()}
												type="text"
											/>
										{:else}
											<span class="truncate flex-1">{line.name}</span>
											{#if actLineEventSummaries.get(line.id)?.endedAt != null}
												<span class="text-[10px] font-medium text-surface-400-600 ml-1 shrink-0">{t('sidebar.actConcluded')}</span>
											{/if}
											<button
												class="text-surface-500 hover:text-surface-700-300 ml-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
												type="button"
												onclick={(e) => {
													e.stopPropagation();
													startRename('line', line.id, line.name);
												}}
												title={t('sidebar.renameLine')}>&#9998;</button
											>
										{/if}
										<button
											class="text-surface-500 hover:text-error-500 ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
											type="button"
											onclick={(e) => {
												e.stopPropagation();
												requestDeleteActLine(line.id, line.name);
											}}
											title={t('sidebar.deleteLine')}>&times;</button
										>
									</div>
								{/each}

								<!-- Add act line button -->
								{#if showNewActLine}
									<div class="pl-8 p-1">
										<div class="flex gap-1">
											<input
												class="input text-xs flex-1"
												placeholder={t('sidebar.lineNamePlaceholder')}
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
										{t('sidebar.newLine')}
									</button>
								{/if}
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		{/each}

		<!-- Add story button -->
		<button
			class="w-full p-3 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500"
			type="button"
			onclick={handleNewStory}
		>
			{t('sidebar.newStory')}
		</button>

		<!-- Sidebar blocking overlay (covers nav only, not footer) -->
		{#if sidebarBlocked}
			<div
				class="absolute inset-0 z-10 bg-surface-50-950/60 backdrop-blur-sm flex items-center justify-center cursor-not-allowed"
				role="alert"
				aria-live="polite"
				aria-busy="true"
			>
				<div class="text-center space-y-2">
					<div class="inline-block w-8 h-8 border-4 border-surface-200-800 border-t-primary-500 rounded-full animate-spin"></div>
					<p class="text-xs text-surface-500">{t('sidebar.worldBuilderActive')}</p>
				</div>
			</div>
		{/if}
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
			class="flex items-center gap-2 p-2 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500"
		>
			{t('sidebar.chat')}
		</a>
		<a
			href="/settings"
			class="flex items-center gap-2 p-2 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500"
		>
			{t('sidebar.settings')}
		</a>
		<a
			href="/memory-manager"
			class="flex items-center gap-2 p-2 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500"
		>
			{t('sidebar.memoryManager')}
		</a>
		<a
			href="/file-manager"
			class="flex items-center gap-2 p-2 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500"
		>
			{t('sidebar.fileManager')}
		</a>
	</div>
{/snippet}

<div class="flex h-screen overflow-hidden bg-surface-50-950" ontouchstart={handleTouchStart} ontouchend={handleTouchEnd}>
	{#if !appReady}
		<div class="flex-1 flex items-center justify-center">
			{#if appError}
				<div class="text-center space-y-3">
					<p class="text-error-500">{appError}</p>
				</div>
			{:else}
				<div class="text-center space-y-2">
					<div class="inline-block w-10 h-10 border-4 border-surface-200-800 border-t-primary-500 rounded-full animate-spin"></div>
					<div class="text-surface-500 animate-pulse">Loading...</div>
					<div class="text-xs text-surface-600">{initStatus}</div>
				</div>
			{/if}
		</div>
	{:else}
		<!-- Desktop Sidebar -->
		<aside class="hidden md:flex lg:w-72 border-r border-surface-200-800 flex-col">
			{@render SidebarNavFooter()}
		</aside>

		<!-- Mobile Sidebar Drawer -->
		{#if sidebarOpen}
			<div class="fixed inset-0 z-[60] flex md:hidden" role="dialog" aria-modal="true">
				<aside class="w-[80vw] max-w-[320px] bg-surface-50-950 border-r border-surface-200-800 flex flex-col overflow-y-auto">
					{@render SidebarNavFooter()}
				</aside>
				<div class="flex-1 bg-black/50" onclick={() => (sidebarOpen = false)} role="button" aria-label="Close sidebar"></div>
			</div>
		{/if}

		<!-- Main content -->
		<main class="flex-1 flex flex-col min-w-0 pb-[52px] md:pb-0">
			<!-- Mobile header bar (tab bar replaces hamburger; just show story name) -->
			<div class="md:hidden flex items-center justify-center p-3 border-b border-surface-200-800 shrink-0">
				<span class="text-sm font-medium text-surface-700-300 truncate">{getActiveStoryName() ?? t('sidebar.chat')}</span>
			</div>

			{@render children()}
			<BottomTabBar onOpenSidebar={() => (sidebarOpen = true)} />
		</main>
	{/if}
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
				{t('sidebar.deleteConfirmTitle', { type: confirmDelete.type })}
			</h3>
			<p class="text-sm text-surface-600-400 mb-5">
				{#if confirmDelete.type === 'story'}
					{t('sidebar.deleteStoryConfirm', { name: confirmDelete.name })}
				{:else if confirmDelete.type === 'act'}
					{t('sidebar.deleteActConfirm', { name: confirmDelete.name })}
				{:else if confirmDelete.type === 'line'}
					{t('sidebar.deleteLineConfirm', { name: confirmDelete.name })}
				{:else}
					{t('sidebar.deleteGenericConfirm', { name: confirmDelete.name })}
				{/if}
			</p>
			{#if confirmDelete.type === 'story' || confirmDelete.type === 'line'}
				<div class="flex flex-col gap-2">
					<button
						class="w-full px-4 py-2 rounded-lg bg-error-500 hover:bg-error-600 text-white text-sm font-medium transition-colors"
						type="button"
						onclick={() => confirmDeleteAction(false)}
					>
						{t('sidebar.deleteKeepFolder')}
					</button>
					<button
						class="w-full px-4 py-2 rounded-lg bg-error-700 hover:bg-error-800 text-white text-sm font-medium transition-colors"
						type="button"
						onclick={() => confirmDeleteAction(true)}
					>
						{t('sidebar.deleteWithFolder')}
					</button>
					<button
						bind:this={cancelButton}
						class="w-full px-4 py-2 rounded-lg bg-surface-200-800 hover:bg-surface-300-700 text-surface-700-300 text-sm transition-colors"
						type="button"
						onclick={cancelDelete}
					>
						{t('sidebar.cancel')}
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
						{t('sidebar.cancel')}
					</button>
					<button
						class="flex-1 px-4 py-2 rounded-lg bg-error-500 hover:bg-error-600 text-white text-sm font-medium transition-colors"
						type="button"
						onclick={() => confirmDeleteAction()}
					>
						{t('sidebar.deleteLabel')}
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
			<h3 id="new-story-dialog-title" class="text-lg font-semibold text-surface-900-100 mb-4">{t('sidebar.createNewStory')}</h3>
			<div class="flex flex-col gap-3">
				<button
					class="w-full text-left p-4 rounded-lg border border-surface-200-800 hover:bg-surface-200-800 transition-colors duration-150"
					type="button"
					onclick={handleStartWorldBuilder}
				>
					<div class="font-medium text-surface-900-100 mb-1">{t('sidebar.worldBuilder')}</div>
					<div class="text-sm text-surface-600-400">{t('sidebar.worldBuilderDescription')}</div>
				</button>
				<button
					class="w-full text-left p-4 rounded-lg border border-surface-200-800 hover:bg-surface-200-800 transition-colors duration-150"
					type="button"
					onclick={handleStartImportWorld}
				>
					<div class="font-medium text-surface-900-100 mb-1">{t('sidebar.importWorld')}</div>
					<div class="text-sm text-surface-600-400">{t('sidebar.importWorldDescription')}</div>
				</button>
			</div>
			<button
				class="w-full mt-4 px-4 py-2 rounded-lg bg-surface-200-800 hover:bg-surface-300-700 text-surface-700-300 text-sm transition-colors"
				type="button"
				onclick={cancelNewStory}
			>
				{t('sidebar.cancel')}
			</button>
		</div>
	</div>
{/if}

<!-- Act Plot Generation Overlay -->
{#if getActPlotGenerationPhase() !== null}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		role="alert"
		aria-live="polite"
		aria-busy="true"
	>
		<div class="bg-surface-100-900 border border-surface-200-800 rounded-xl shadow-2xl p-8 text-center">
			<div class="inline-block w-10 h-10 border-4 border-surface-200-800 border-t-primary-500 rounded-full animate-spin"></div>
			<p class="mt-4 text-surface-950-50">
				{#if getActPlotGenerationPhase() === 'writing'}
					{t('sidebar.actPlotWriting')}
				{:else if getActPlotGenerationPhase() === 'reviewing'}
					{t('sidebar.actPlotReviewing')}
				{:else if getActPlotGenerationPhase() === 'editing'}
					{t('sidebar.actPlotEditing')}
				{:else}
					{t('sidebar.actPlotGenerating')}
				{/if}
			</p>
		</div>
	</div>
{/if}
