<script lang="ts">
	import './+layout.css';
	import { onMount } from 'svelte';
	import { clamp } from 'lodash-es';
	import { goto, beforeNavigate } from '$app/navigation';
	import { initializeApp } from '$lib/app/init.svelte';
	import { log } from '$lib/logging/logger';
	import { registerSW } from 'virtual:pwa-register';
	import {
		getActiveStoryName,
		getActiveActLineId,
		getActPlotGenerationPhase,
		selectStory,
		selectAct,
		selectActLine,
		deleteStory,
		deleteAct,
		deleteActLine,
	} from '$lib/stores/stories.svelte';
	import { loadActLineMessages, clearMessages } from '$lib/ai/chat.svelte';
	import {
		enterWorldBuilderMode,
		exitWorldBuilderMode,
		getIsActive as getIsWorldBuilderActive,
	} from '$lib/features/world-builder/world-builder.svelte';
	import { getSettings, updateSettings } from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';

	import BottomTabBar from '$lib/components/BottomTabBar.svelte';
	import { mobileNav, mobileFeatures } from '$lib/stores/mobile-nav.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import SidebarNav from '$lib/components/chat/SidebarNav.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import { Toast } from '@skeletonlabs/skeleton-svelte';
	import { toaster } from '$lib/stores/toaster.svelte';

	let { children } = $props();
	let appError = $state<string | null>(null);
	let initStatus = $state('Starting...');
	let appReady = $state(false);
	let sidebarOpen = $state(false);
	let suppressSidebarClose = $state(false);

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
	let touchInSwipeRow = false;
	const EDGE_THRESHOLD = 30;
	const SWIPE_MIN_X = 60;
	const SWIPE_MAX_Y = 40;

	function handleTouchStart(e: TouchEvent) {
		touchStartX = e.changedTouches[0].screenX;
		touchStartY = e.changedTouches[0].screenY;
		// If the touch started inside a row that has its own swipe-to-reveal
		// gesture, let that row handle it. Closing the sidebar here would
		// race with the row's swipeend and dismiss the row.
		const target = e.target as Element | null;
		touchInSwipeRow = !!target?.closest('[data-swipe-row]');
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
		// Swipe left on sidebar to close — but not if a row's own
		// swipe-to-reveal gesture is in progress, otherwise the row
		// gesture competes with the drawer-close gesture.
		if (dx < -SWIPE_MIN_X && Math.abs(dy) < SWIPE_MAX_Y && sidebarOpen && !touchInSwipeRow) {
			sidebarOpen = false;
		}
		touchInSwipeRow = false;
	}

	// Delete confirmation state
	type DeleteTarget = { type: 'story' | 'act' | 'line'; id: string; name: string };
	let confirmDelete = $state<DeleteTarget | null>(null);

	// New story mode selection
	let showNewStoryModal = $state(false);

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

	// Close sidebar drawer on any navigation (prevents it staying open across pages)
	beforeNavigate(() => {
		if (!suppressSidebarClose) {
			sidebarOpen = false;
		}
		suppressSidebarClose = false;
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
		suppressSidebarClose = true;
		if (getIsWorldBuilderActive()) exitWorldBuilderMode();
		await selectStory(id);
		clearMessages();
		goto('/');
	}

	async function handleSelectAct(id: string) {
		suppressSidebarClose = true;
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

	// === Delete handlers ===

	function requestDelete(type: 'story' | 'act' | 'line', id: string, name: string) {
		confirmDelete = { type, id, name };
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
</script>

<div class="flex h-dvh overflow-hidden bg-surface-50-950" ontouchstart={handleTouchStart} ontouchend={handleTouchEnd}>
	{#if !appReady}
		<div class="flex-1 flex items-center justify-center">
			{#if appError}
				<div class="text-center space-y-3">
					<p class="text-error-500">{appError}</p>
				</div>
			{:else}
				<div class="text-center space-y-2">
					<Spinner size="xl" />
					<div class="text-surface-500 animate-pulse">Loading...</div>
					<div class="text-xs text-surface-600">{initStatus}</div>
				</div>
			{/if}
		</div>
	{:else}
		<!-- Desktop Sidebar -->
		<aside class="hidden md:flex lg:w-72 border-r border-surface-200-800 flex-col">
			<SidebarNav
				variant="desktop"
				onSelectStory={handleSelectStory}
				onSelectAct={handleSelectAct}
				onSelectActLine={handleSelectActLine}
				onRequestDeleteStory={(id, name) => requestDelete('story', id, name)}
				onRequestDeleteAct={(id, name) => requestDelete('act', id, name)}
				onRequestDeleteActLine={(id, name) => requestDelete('line', id, name)}
				onNewStory={handleNewStory}
			/>
		</aside>

		<!-- Mobile Sidebar Drawer -->
		{#if sidebarOpen}
			<div class="fixed inset-0 z-60 flex md:hidden" role="dialog" aria-modal="true">
				<aside class="w-[80vw] max-w-[320px] bg-surface-50-950 border-r border-surface-200-800 flex flex-col overflow-y-auto">
					<SidebarNav
						variant="mobile"
						onSelectStory={handleSelectStory}
						onSelectAct={handleSelectAct}
						onSelectActLine={handleSelectActLine}
						onRequestDeleteStory={(id, name) => requestDelete('story', id, name)}
						onRequestDeleteAct={(id, name) => requestDelete('act', id, name)}
						onRequestDeleteActLine={(id, name) => requestDelete('line', id, name)}
						onNewStory={handleNewStory}
					/>
				</aside>
				<div class="flex-1 bg-black/50" onclick={() => (sidebarOpen = false)} role="button" aria-label="Close sidebar"></div>
			</div>
		{/if}

		<!-- Main content -->
		<main class="flex-1 flex flex-col min-w-0 pb-[calc(52px+env(safe-area-inset-bottom))] md:pb-0">
			<!-- Mobile header bar (tab bar replaces hamburger; just show story name) -->
			<div class="md:hidden flex items-center justify-center p-3 border-b border-surface-200-800 shrink-0">
				<button class="text-sm font-medium text-surface-700-300 truncate cursor-pointer" onclick={() => (sidebarOpen = true)} type="button">
					{getActiveStoryName() ?? t('sidebar.chat')}
				</button>
			</div>

			{@render children()}
			<BottomTabBar onOpenSidebar={() => (sidebarOpen = true)} />
		</main>
	{/if}
</div>

<!-- Delete Confirmation Modal -->
<Modal
	open={confirmDelete !== null}
	title={confirmDelete ? t('sidebar.deleteConfirmTitle', { type: confirmDelete.type }) : ''}
	onclose={cancelDelete}
>
	{#snippet body()}
		<p class="text-sm text-surface-600-400">
			{#if confirmDelete?.type === 'story'}
				{t('sidebar.deleteStoryConfirm', { name: confirmDelete.name })}
			{:else if confirmDelete?.type === 'act'}
				{t('sidebar.deleteActConfirm', { name: confirmDelete.name })}
			{:else if confirmDelete?.type === 'line'}
				{t('sidebar.deleteLineConfirm', { name: confirmDelete.name })}
			{:else}
				{t('sidebar.deleteGenericConfirm', { name: confirmDelete?.name ?? '' })}
			{/if}
		</p>
	{/snippet}
	{#snippet footer()}
		{#if confirmDelete?.type === 'story' || confirmDelete?.type === 'line'}
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
	{/snippet}
</Modal>

<!-- New Story Modal -->
<Modal bind:open={showNewStoryModal} title={t('sidebar.createNewStory')} width="md">
	{#snippet body()}
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
	{/snippet}
	{#snippet footer()}
		<button
			class="w-full px-4 py-2 rounded-lg bg-surface-200-800 hover:bg-surface-300-700 text-surface-700-300 text-sm transition-colors"
			type="button"
			onclick={cancelNewStory}
		>
			{t('sidebar.cancel')}
		</button>
	{/snippet}
</Modal>

<!-- Act Plot Generation Overlay -->
{#if getActPlotGenerationPhase() !== null}
	<div
		class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm"
		role="alert"
		aria-live="polite"
		aria-busy="true"
	>
		<div class="bg-surface-100-900 border border-surface-200-800 rounded-xl shadow-2xl p-8 text-center">
			<Spinner size="xl" />
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

<!-- App-wide Toast container -->
<Toast.Group {toaster}>
	{#snippet children(toast)}
		<Toast {toast} class="bg-surface-50-950 border border-surface-200-800 rounded-xl shadow-xl">
			<Toast.Message class="p-3 pr-2">
				<Toast.Title class="text-sm font-medium text-surface-950-50">{toast.title}</Toast.Title>
			</Toast.Message>
			<Toast.CloseTrigger class="text-sm px-2 opacity-70 hover:opacity-100 text-surface-950-50">×</Toast.CloseTrigger>
		</Toast>
	{/snippet}
</Toast.Group>
