<script lang="ts">
	import { t } from '$lib/i18n';
	import {
		getStories,
		getActs,
		getActLines,
		getActiveStoryId,
		getActiveActId,
		getActiveActLineId,
		renameStory,
		renameAct,
		renameActLine,
		createActLine,
	} from '$lib/stores/stories.svelte';
	import { getIsActive as getIsWorldBuilderActive } from '$lib/features/world-builder/world-builder.svelte';
	import { batchGetActLineEventSummary, type ActLineEventSummary } from '$lib/db/act-lines';
	import { getActEnded, getStoryConcluded } from '$lib/ai/chat.svelte';
	import { getSettings, updateSettings } from '$lib/stores/settings.svelte';
	import { type SwipeEndEventDetail } from '@svelte-put/swipeable';
	import SidebarRow from './SidebarRow.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';

	interface Props {
		variant: 'desktop' | 'mobile';
		onSelectStory: (id: string) => void;
		onSelectAct: (id: string) => void;
		onSelectActLine: (id: string) => void;
		onRequestDeleteStory: (id: string, name: string) => void;
		onRequestDeleteAct: (id: string, name: string) => void;
		onRequestDeleteActLine: (id: string, name: string) => void;
		onNewStory: () => void;
	}

	let {
		variant,
		onSelectStory,
		onSelectAct,
		onSelectActLine,
		onRequestDeleteStory,
		onRequestDeleteAct,
		onRequestDeleteActLine,
		onNewStory,
	}: Props = $props();

	let editingId = $state<string | null>(null);
	let editingType = $state<'story' | 'act' | 'line' | null>(null);
	let editingName = $state('');
	let renameSubmitting = $state(false);
	let newActLineName = $state('');
	let showNewActLine = $state(false);
	let actLineEventSummaries = $state<Map<string, ActLineEventSummary>>(new Map());
	let sidebarBlocked = $derived(getIsWorldBuilderActive());

	// --- Mobile swipe state ---
	// `openSwipeRowId` identifies the row currently revealed by a swipe.
	// The direction is implied by the row's role: rows opening left-to-right
	// reveal Rename (Pencil) on the left, rows opening right-to-left reveal
	// Delete (Trash) on the right. Only one row can be open at a time.
	let openSwipeRowId = $state<string | null>(null);
	let openSwipeOffset = $state(0);
	// Suppress click events that fire immediately after a swipe-end gesture.
	// Real touch devices fire a trailing `click` after `pointerup`; without
	// suppression, that click closes the row the swipe just opened.
	// The flag is single-shot: the first click handler that sees it consumes
	// it (and stops propagation) so the row stays open. Using a microtask
	// would clear it before the trailing click, which is the original bug.
	let justSwipedRowId = $state<string | null>(null);

	const swipeConfig = {
		direction: ['left', 'right'],
		threshold: '30%',
		customPropertyPrefix: null,
		followThrough: false,
		allowFlick: true,
		disableTouchEvents: false,
	} satisfies {
		direction: ('left' | 'right')[];
		threshold: `${number}%`;
		customPropertyPrefix: string | null;
		followThrough: boolean;
		allowFlick: boolean;
		disableTouchEvents: boolean;
	};

	function closeSwipe(rowId: string) {
		if (openSwipeRowId !== rowId) return;
		openSwipeRowId = null;
		openSwipeOffset = 0;
	}

	function handleSwipeEnd(rowId: string) {
		return (e: CustomEvent<SwipeEndEventDetail>) => {
			const { direction, passThreshold } = e.detail;
			if (passThreshold) {
				openSwipeRowId = rowId;
				openSwipeOffset = direction === 'left' ? -100 : 100;
				// Mark this row so the trailing click (which browsers fire
				// after pointerup on real touch devices) is consumed by the
				// first click handler that sees it instead of closing the row.
				justSwipedRowId = rowId;
			} else {
				closeSwipe(rowId);
			}
		};
	}

	function handleContentClick(rowId: string) {
		return (e: Event) => {
			if (justSwipedRowId === rowId) {
				// Trailing click from a swipe-end gesture; consume the flag
				// and stop propagation so the row we just opened doesn't snap shut.
				e.stopPropagation();
				justSwipedRowId = null;
				return;
			}
			if (openSwipeRowId === rowId) {
				e.stopPropagation();
				closeSwipe(rowId);
			}
		};
	}

	function handleMobileAction(rowId: string, action: () => void) {
		return (e: Event) => {
			e.stopPropagation();
			action();
			closeSwipe(rowId);
		};
	}

	// --------------------------

	$effect(() => {
		const lines = getActLines();
		getActEnded(); // reactive dep: triggers re-run when actEnded changes
		getStoryConcluded(); // reactive dep: triggers re-run when storyConcluded changes
		if (lines.length === 0) {
			actLineEventSummaries = new Map();
			return;
		}
		const ids = lines.map((l) => l.id);
		batchGetActLineEventSummary(ids).then((map) => {
			actLineEventSummaries = map;
		});
	});

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
		if (editingType === 'story') await renameStory(editingId, name);
		else if (editingType === 'act') await renameAct(editingId, name);
		else if (editingType === 'line') await renameActLine(editingId, name);
		cancelRename();
	}

	async function handleCreateActLine() {
		const name = newActLineName.trim();
		const actId = getActiveActId();
		if (!name || !actId) return;
		const line = await createActLine(actId, name);
		newActLineName = '';
		showNewActLine = false;
		onSelectActLine(line.id);
	}

	let fontSizeSlider = $derived(getSettings().fontSize);

	function handleFontSizeChange(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		updateSettings({ fontSize: parseFloat(target.value) });
	}

	let isDesktop = $derived(variant === 'desktop');
	// Close any open row when user clicks/taps anywhere outside the open row
	function handleGlobalTap(e: MouseEvent) {
		if (justSwipedRowId) {
			// A swipe gesture just finished; consume the trailing click so
			// it won't close the row we just opened. (The inner sliding div
			// or its row should have already consumed it, but this guards
			// against the click landing outside the row in the nav area.)
			e.stopPropagation();
			justSwipedRowId = null;
			return;
		}
		if (!openSwipeRowId) return;
		if (e.target instanceof HTMLElement) {
			const targetRow = e.target.closest('[data-swipe-row]') as HTMLElement | null;
			if (!targetRow || targetRow.dataset.swipeRow !== openSwipeRowId) {
				closeSwipe(openSwipeRowId);
			}
		}
	}
</script>

<nav class="flex-1 overflow-y-auto p-2 pt-4 space-y-1 relative" onclick={handleGlobalTap}>
	{#each getStories() as story (story.id)}
		<div class="space-y-0.5">
			<SidebarRow
				rowId={story.id}
				variant={isDesktop ? 'desktop' : 'mobile'}
				isActive={getActiveStoryId() === story.id}
				isEditing={editingId === story.id && editingType === 'story'}
				size="sm"
				activeClass="bg-surface-200-800"
				bind:renameValue={editingName}
				canDelete
				{swipeConfig}
				isOpen={openSwipeRowId === story.id}
				openOffset={openSwipeOffset}
				renameAriaLabel={t('sidebar.renameStory')}
				deleteAriaLabel={t('sidebar.deleteStory')}
				onSelect={() => onSelectStory(story.id)}
				onRequestDelete={() => onRequestDeleteStory(story.id, story.name)}
				onStartRename={() => startRename('story', story.id, story.name)}
				onSubmitRename={submitRename}
				onCancelRename={cancelRename}
				onSwipeEnd={handleSwipeEnd(story.id)}
				onContentClick={handleContentClick(story.id)}
				onMobileAction={handleMobileAction}
				onDismissOpen={() => closeSwipe(story.id)}
				{justSwipedRowId}
				setJustSwiped={(id) => (justSwipedRowId = id)}
			>
				<span class="text-sm font-medium truncate flex-1">{story.name}</span>
			</SidebarRow>

			<!-- Acts (only show for active story) -->
			{#if getActiveStoryId() === story.id}
				{#each getActs() as act (act.id)}
					<div class="ml-3 space-y-0.5">
						<SidebarRow
							rowId={act.id}
							variant={isDesktop ? 'desktop' : 'mobile'}
							isActive={getActiveActId() === act.id}
							isEditing={editingId === act.id && editingType === 'act'}
							size="sm"
							indent="pl-4"
							activeClass="bg-surface-200-800"
							bind:renameValue={editingName}
							canDelete={getActs().length > 1 && getActs().at(-1)?.id === act.id}
							{swipeConfig}
							isOpen={openSwipeRowId === act.id}
							openOffset={openSwipeOffset}
							renameAriaLabel={t('sidebar.renameAct')}
							deleteAriaLabel={t('sidebar.deleteAct')}
							onSelect={() => onSelectAct(act.id)}
							onRequestDelete={() => onRequestDeleteAct(act.id, act.name)}
							onStartRename={() => startRename('act', act.id, act.name)}
							onSubmitRename={submitRename}
							onCancelRename={cancelRename}
							onSwipeEnd={handleSwipeEnd(act.id)}
							onContentClick={handleContentClick(act.id)}
							onMobileAction={handleMobileAction}
							onDismissOpen={() => closeSwipe(act.id)}
							{justSwipedRowId}
							setJustSwiped={(id) => (justSwipedRowId = id)}
						>
							<span class="truncate flex-1 text-surface-700-300">{t('common.actLabel', { n: act.actNumber })}: {act.name}</span>
						</SidebarRow>

						<!-- Act Lines -->
						{#if getActiveActId() === act.id}
							{#each getActLines() as line (line.id)}
								<SidebarRow
									rowId={line.id}
									variant={isDesktop ? 'desktop' : 'mobile'}
									isActive={getActiveActLineId() === line.id}
									isEditing={editingId === line.id && editingType === 'line'}
									size="xs"
									indent="pl-8"
									activeClass="bg-primary-100-900 text-primary-700-300"
									bind:renameValue={editingName}
									canDelete
									{swipeConfig}
									isOpen={openSwipeRowId === line.id}
									openOffset={openSwipeOffset}
									renameAriaLabel={t('sidebar.renameLine')}
									deleteAriaLabel={t('sidebar.deleteLine')}
									onSelect={() => onSelectActLine(line.id)}
									onRequestDelete={() => onRequestDeleteActLine(line.id, line.name)}
									onStartRename={() => startRename('line', line.id, line.name)}
									onSubmitRename={submitRename}
									onCancelRename={cancelRename}
									onSwipeEnd={handleSwipeEnd(line.id)}
									onContentClick={handleContentClick(line.id)}
									onMobileAction={handleMobileAction}
									onDismissOpen={() => closeSwipe(line.id)}
									{justSwipedRowId}
									setJustSwiped={(id) => (justSwipedRowId = id)}
								>
									<span class="truncate flex-1">{line.name}</span>
									{#if actLineEventSummaries.get(line.id)?.endedAt != null}
										<span class="text-[10px] font-medium text-surface-400-600 ml-1 shrink-0">{t('sidebar.actConcluded')}</span>
									{/if}
								</SidebarRow>
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
		onclick={onNewStory}
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
				<Spinner size="lg" />
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
