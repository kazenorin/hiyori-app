<script lang="ts">
	import { t } from '$lib/i18n';
	import { version } from '$lib/app/version';
	import {
		getStories,
		getActs,
		getActLines,
		getActiveAct,
		getActiveStoryId,
		getActiveActId,
		getActiveActLineId,
		renameStory,
		renameAct,
		renameActLine,
		setStoryOrder,
		selectAct,
		selectActLine,
	} from '$lib/stores/stories.svelte';
	import { getIsActive as getIsWorldBuilderActive } from '$lib/features/world-builder/world-builder.svelte';
	import { batchGetActLineEventSummary, getActLinesForStory, type ActLineEventSummary, type ActLineMeta } from '$lib/db/act-lines';
	import { canActBeDeleted, canActLineBeDeleted, getActByActLineId } from '$lib/db/acts';
	import { getActEnded, getStoryConcluded } from '$lib/ai/chat.svelte';
	import { getSettings, isMemoryAvailable, updateSettings } from '$lib/stores/settings.svelte';
	import { exportStory } from '$lib/features/story-export-load/story-exporter';
	import { getCloudSyncStatus, runCloudSync, getCloudSyncError } from '$lib/features/cloud-sync/cloud-sync.svelte';
	import { createBackendFromSettings } from '$lib/features/cloud-sync/backend-factory';
	import { toaster } from '$lib/stores/toaster.svelte';
	import { type SwipeEndEventDetail } from '@svelte-put/swipeable';
	import Sortable from 'sortablejs';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { openSettingsDialog } from '$lib/features/settings/settings-dialog-state.svelte';
	import SidebarRow from './SidebarRow.svelte';
	import SidebarRowMenu from './SidebarRowMenu.svelte';
	import SidebarCollapsedIcons from './SidebarCollapsedIcons.svelte';
	import { getLineageGroupsForStory, type LineageGroupsResult } from '$lib/db/lineage-groups';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

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
	// Only one row sub-menu may be open at a time; the key identifies the row
	// owning the open menu (uncontrolled popovers never close each other).
	let openRowMenuId = $state<string | null>(null);

	function rowMenuControl(key: string) {
		return {
			open: openRowMenuId === key,
			onOpenChange: (open: boolean) => (openRowMenuId = open ? key : null),
		};
	}
	let actLineEventSummaries = $state<Map<string, ActLineEventSummary>>(new Map());
	// Act lines of every act in the active story, needed to decide whether an
	// act can be deleted (getActLines() only covers the active act).
	let storyActLines = $state<ActLineMeta[]>([]);
	let sidebarBlocked = $derived(getIsWorldBuilderActive());

	// --- Drag reordering of stories ---
	let storyListEl = $state<HTMLDivElement | null>(null);
	let sortable: Sortable | null = null;

	$effect(() => {
		if (storyListEl && !sortable) {
			sortable = Sortable.create(storyListEl, {
				animation: 150,
				delay: 300,
				delayOnTouchOnly: true,
				// Mobile: drag starts immediately from the grip handle. Whole-row
				// long-press is unreliable on touch (finger jitter during the delay
				// cancels the drag), so desktop keeps it and mobile uses the handle.
				...(variant === 'desktop' ? {} : { handle: '[data-story-drag-handle]', delay: 0 }),
				onEnd: () => {
					if (!storyListEl) return;
					const order = [...storyListEl.querySelectorAll<HTMLElement>('[data-story-id]')].map((el) => el.dataset.storyId!);
					setStoryOrder(order);
				},
			});
		}
		return () => {
			sortable?.destroy();
			sortable = null;
		};
	});

	$effect(() => {
		sortable?.option('disabled', sidebarBlocked || editingId !== null);
	});

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
		getActLines(); // reactive dep: re-run when the active act's lines change
		getActEnded(); // reactive dep: triggers re-run when actEnded changes
		getStoryConcluded(); // reactive dep: triggers re-run when storyConcluded changes
		// Summarize every line of the active story so badges also work in lineage mode.
		const lines = storyActLines.length > 0 ? storyActLines : getActLines();
		if (lines.length === 0) {
			actLineEventSummaries = new Map();
			return;
		}
		const ids = lines.map((l) => l.id);
		batchGetActLineEventSummary(ids).then((map) => {
			actLineEventSummaries = map;
		});
	});

	$effect(() => {
		const storyId = getActiveStoryId();
		getActs(); // reactive dep: re-run when acts are added/removed
		getActLines(); // reactive dep: re-run when the active act's lines change
		if (!storyId) {
			storyActLines = [];
			return;
		}
		getActLinesForStory(storyId).then((lines) => {
			storyActLines = lines;
		});
	});

	// Lineage groups per story, for the "Group by Act Line" mode and toggle visibility.
	let lineageByStory = $state<Map<string, LineageGroupsResult>>(new Map());

	$effect(() => {
		const ids = getStories().map((s) => s.id);
		getActs(); // reactive dep: acts/lines changes re-run this
		getActLines();
		if (ids.length === 0) {
			lineageByStory = new Map();
			return;
		}
		Promise.all(ids.map((id) => getLineageGroupsForStory(id))).then((results) => {
			lineageByStory = new Map(ids.map((id, i) => [id, results[i]]));
		});
	});

	function handleToggleGroup(storyId: string, value: boolean) {
		const current = { ...(getSettings().groupByActLine ?? {}) };
		current[storyId] = value;
		updateSettings({ groupByActLine: current });
	}

	function handleContextManagement() {
		goto(resolve('/context-management'));
	}

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

	let fontSizeSlider = $derived(getSettings().fontSize);
	let exportingStory = $state(false);

	async function handleExportStory(storyId: string | null = getActiveStoryId()) {
		if (!storyId || exportingStory) return;
		exportingStory = true;
		try {
			await exportStory(storyId);
			toaster.success({ title: t('sidebar.exportSuccess') });
		} catch (err) {
			console.error('Failed to export story:', err);
			toaster.error({ title: t('sidebar.exportFailed') });
		} finally {
			exportingStory = false;
		}
	}

	function isCloudSyncConfigured(): boolean {
		return !!createBackendFromSettings(getSettings());
	}

	async function handleCloudSync() {
		if (!getActiveStoryId() || getCloudSyncStatus() === 'syncing') return;
		try {
			await runCloudSync();
			if (getCloudSyncError()) {
				toaster.error({ title: t('sidebar.cloudSyncFailed') });
			} else {
				toaster.success({ title: t('sidebar.cloudSyncSuccess') });
			}
		} catch {
			toaster.error({ title: t('sidebar.cloudSyncFailed') });
		}
	}

	function handleFontSizeChange(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		updateSettings({ fontSize: parseFloat(target.value) });
	}

	let isDesktop = $derived(variant === 'desktop');
	const collapsedMode = $derived(isDesktop && getSettings().sidebarCollapsed);
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

{#if collapsedMode}
	<SidebarCollapsedIcons
		stories={getStories()}
		activeStoryId={getActiveStoryId()}
		activeActLineId={getActiveActLineId()}
		acts={getActs()}
		{storyActLines}
		lineage={lineageByStory.get(getActiveStoryId() ?? '')}
		groupByLine={getSettings().groupByActLine[getActiveStoryId() ?? ''] ?? false}
		{onSelectStory}
		{onSelectActLine}
		{onRequestDeleteStory}
		onRequestDeleteAct={(id, name) => onRequestDeleteAct(id, name)}
		onRequestDeleteActLine={(id, name) => onRequestDeleteActLine(id, name)}
		onStartRenameAct={(id, name) => {
			updateSettings({ sidebarCollapsed: false });
			startRename('act', id, name);
		}}
		onStartRenameLine={async (id, name) => {
			// Expand, then sync the active act/line so the renamed line's row is
			// visible in the expanded tree (both grouping modes). No message reload.
			updateSettings({ sidebarCollapsed: false });
			const act = await getActByActLineId(id);
			if (act && act.id !== getActiveActId()) await selectAct(act.id);
			await selectActLine(id);
			startRename('line', id, name);
		}}
		onStartRenameStory={(id, name) => {
			// Inline rename lives in the expanded tree — expand, then edit.
			updateSettings({ sidebarCollapsed: false });
			startRename('story', id, name);
		}}
		onExportStory={(id) => handleExportStory(id)}
		onContextManagement={handleContextManagement}
		{onNewStory}
		onToggleGroup={handleToggleGroup}
		onCloudSync={handleCloudSync}
		cloudSyncAvailable={isCloudSyncConfigured()}
		cloudSyncBusy={getCloudSyncStatus() === 'syncing'}
	/>
{:else}
	<!-- Toolbar: New/Load Story + collapse button (pinned above the scroll area) -->
	<div class="relative flex-1 flex flex-col min-h-0">
		<div class="flex items-center gap-1 p-2 pb-1 shrink-0">
			<button
				class="flex-1 flex items-center justify-center gap-1 p-2 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150 text-xs text-surface-500 whitespace-nowrap cursor-pointer"
				type="button"
				onclick={onNewStory}
			>
				<Icon name="plus" class="w-3.5 h-3.5" />
				{t('sidebar.newStory')}
			</button>
			<a
				href={resolve('/load-story')}
				class="flex-1 flex items-center justify-center gap-1 p-2 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150 text-xs text-surface-500 whitespace-nowrap"
			>
				<Icon name="hard-drive-upload" class="w-3.5 h-3.5" />
				{t('sidebar.loadStory')}
			</a>
			{#if isDesktop}
				<button
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-(--radius-base) text-surface-500 hover:bg-surface-200-800 hover:text-surface-700-300 cursor-pointer"
					type="button"
					aria-label={t('sidebar.collapseSidebar')}
					title={t('sidebar.collapseSidebar')}
					onclick={() => updateSettings({ sidebarCollapsed: true })}
				>
					<Icon name="panel-left-close" class="h-4 w-4" />
				</button>
			{/if}
		</div>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<nav class="flex-1 overflow-y-auto px-2 pt-1 space-y-1" onclick={handleGlobalTap}>
			<div bind:this={storyListEl} class="space-y-0.5">
				{#each getStories() as story (story.id)}
					<div class="space-y-0.5" data-story-id={story.id}>
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
							{#if !isDesktop}
								<!-- Mobile drag-to-reorder handle (touch-none so the browser never claims the gesture) -->
								<span data-story-drag-handle class="shrink-0 text-surface-400-600 touch-none cursor-grab" aria-hidden="true">
									<Icon name="grip-vertical" class="w-4 h-4" />
								</span>
							{/if}
							<span class="text-sm font-medium truncate flex-1">{story.name}</span>
							{#snippet menu()}
								<SidebarRowMenu
									kind="story"
									canDelete
									{...rowMenuControl('story-' + story.id)}
									showGroupToggle={lineageByStory.get(story.id)?.toggleVisible ?? false}
									groupByLine={getSettings().groupByActLine[story.id] ?? false}
									onEdit={() => startRename('story', story.id, story.name)}
									onDelete={() => onRequestDeleteStory(story.id, story.name)}
									onExport={() => handleExportStory(story.id)}
									onContextManagement={handleContextManagement}
									onToggleGroup={(v) => handleToggleGroup(story.id, v)}
								/>
							{/snippet}
						</SidebarRow>

						<!-- Lineage groups if toggled, else acts -->
						{#if getActiveStoryId() === story.id}
							{@const lineage = lineageByStory.get(story.id)}
							{@const groupOn = (getSettings().groupByActLine[story.id] ?? false) && (lineage?.toggleVisible ?? false)}
							{#if groupOn && lineage}
								{#each lineage.groups as group (group.leafId)}
									{@const expanded = group.items.some((i) => i.lineId === getActiveActLineId())}
									<div class="ml-3 space-y-0.5">
										<SidebarRow
											rowId={'group-' + group.leafId}
											variant={isDesktop ? 'desktop' : 'mobile'}
											isActive={expanded}
											size="sm"
											indent="pl-4"
											activeClass="bg-surface-200-800"
											{swipeConfig}
											onSelect={() => onSelectActLine(group.leafId)}
										>
											<span class="truncate flex-1 text-surface-700-300"
												>{t('common.actLabel', { n: group.leafActNumber })}: {group.leafName}</span
											>
											{#snippet menu()}
												<SidebarRowMenu
													kind="group"
													canDelete={false}
													{...rowMenuControl('group-' + group.leafId)}
													showGroupToggle
													groupByLine={getSettings().groupByActLine[story.id] ?? false}
													onEdit={() => {}}
													onDelete={() => {}}
													onExport={() => handleExportStory()}
													onContextManagement={handleContextManagement}
													onToggleGroup={(v) => handleToggleGroup(story.id, v)}
												/>
											{/snippet}
										</SidebarRow>
										{#if expanded}
											{#each group.items as item (item.lineId)}
												<SidebarRow
													rowId={item.lineId}
													variant={isDesktop ? 'desktop' : 'mobile'}
													isActive={getActiveActLineId() === item.lineId}
													isEditing={editingId === item.lineId && editingType === 'line'}
													size="xs"
													indent="pl-8"
													activeClass="bg-primary-100-900 text-primary-700-300"
													bind:renameValue={editingName}
													canDelete={(item.actNumber !== 1 || storyActLines.filter((l) => l.actId === item.actId).length > 1) &&
														canActLineBeDeleted(item.lineId, getActs())}
													{swipeConfig}
													isOpen={openSwipeRowId === item.lineId}
													openOffset={openSwipeOffset}
													renameAriaLabel={t('sidebar.renameLine')}
													deleteAriaLabel={t('sidebar.deleteLine')}
													onSelect={() => onSelectActLine(item.lineId)}
													onRequestDelete={() => onRequestDeleteActLine(item.lineId, item.name)}
													onStartRename={() => startRename('line', item.lineId, item.name)}
													onSubmitRename={submitRename}
													onCancelRename={cancelRename}
													onSwipeEnd={handleSwipeEnd(item.lineId)}
													onContentClick={handleContentClick(item.lineId)}
													onMobileAction={handleMobileAction}
													onDismissOpen={() => closeSwipe(item.lineId)}
													{justSwipedRowId}
													setJustSwiped={(id) => (justSwipedRowId = id)}
												>
													<span class="truncate flex-1">{t('common.actLabel', { n: item.actNumber })}: {item.name}</span>
													{#if actLineEventSummaries.get(item.lineId)?.endedAt != null}
														<span class="text-[10px] font-medium text-surface-400-600 ml-1 shrink-0">{t('sidebar.actConcluded')}</span>
													{/if}
													{#snippet menu()}
														<SidebarRowMenu
															kind="line"
															canDelete={(item.actNumber !== 1 || storyActLines.filter((l) => l.actId === item.actId).length > 1) &&
																canActLineBeDeleted(item.lineId, getActs())}
															{...rowMenuControl('line-' + item.lineId)}
															showGroupToggle={lineage?.toggleVisible ?? false}
															groupByLine={getSettings().groupByActLine[story.id] ?? false}
															onEdit={() => startRename('line', item.lineId, item.name)}
															onDelete={() => onRequestDeleteActLine(item.lineId, item.name)}
															onExport={() => handleExportStory()}
															onContextManagement={handleContextManagement}
															onToggleGroup={(v) => handleToggleGroup(story.id, v)}
														/>
													{/snippet}
												</SidebarRow>
											{/each}
										{/if}
									</div>
								{/each}
							{:else}
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
											canDelete={canActBeDeleted(act, getActs(), storyActLines)}
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
											{#snippet menu()}
												<SidebarRowMenu
													kind="act"
													canDelete={canActBeDeleted(act, getActs(), storyActLines)}
													{...rowMenuControl('act-' + act.id)}
													showGroupToggle={lineageByStory.get(story.id)?.toggleVisible ?? false}
													groupByLine={getSettings().groupByActLine[story.id] ?? false}
													onEdit={() => startRename('act', act.id, act.name)}
													onDelete={() => onRequestDeleteAct(act.id, act.name)}
													onExport={() => handleExportStory()}
													onContextManagement={handleContextManagement}
													onToggleGroup={(v) => handleToggleGroup(story.id, v)}
												/>
											{/snippet}
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
													canDelete={(getActiveAct()?.actNumber !== 1 || getActLines().length > 1) &&
														canActLineBeDeleted(line.id, getActs())}
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
													{#snippet menu()}
														<SidebarRowMenu
															kind="line"
															canDelete={(getActiveAct()?.actNumber !== 1 || getActLines().length > 1) &&
																canActLineBeDeleted(line.id, getActs())}
															{...rowMenuControl('line-' + line.id)}
															showGroupToggle={lineageByStory.get(story.id)?.toggleVisible ?? false}
															groupByLine={getSettings().groupByActLine[story.id] ?? false}
															onEdit={() => startRename('line', line.id, line.name)}
															onDelete={() => onRequestDeleteActLine(line.id, line.name)}
															onExport={() => handleExportStory()}
															onContextManagement={handleContextManagement}
															onToggleGroup={(v) => handleToggleGroup(story.id, v)}
														/>
													{/snippet}
												</SidebarRow>
											{/each}
										{/if}
									</div>
								{/each}
							{/if}
						{/if}
					</div>
				{/each}
			</div>
		</nav>

		<!-- Sidebar blocking overlay (covers toolbar + nav, not footer) -->
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
	</div>

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
		{#if isCloudSyncConfigured()}
			<button
				class="flex items-center gap-2 p-2 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500 w-full text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
				type="button"
				onclick={handleCloudSync}
				disabled={!getActiveStoryId() || getCloudSyncStatus() === 'syncing'}
			>
				<Icon name="cloud-sync" class="w-4 h-4 shrink-0" />
				{getCloudSyncStatus() === 'syncing' ? t('cloudSync.syncing') : t('sidebar.syncToCloud')}
			</button>
		{/if}
		{#if isMemoryAvailable()}
			<a
				href={resolve('/memory-manager')}
				class="flex items-center gap-2 p-2 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500"
			>
				<Icon name="message-square-more" class="w-4 h-4 shrink-0" />
				{t('sidebar.memoryManager')}
			</a>
		{/if}
		<a
			href={resolve('/file-manager')}
			class="flex items-center gap-2 p-2 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500"
		>
			<Icon name="folder-cog" class="w-4 h-4 shrink-0" />
			{t('sidebar.fileManager')}
		</a>
		<button
			class="flex items-center gap-2 p-2 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500 w-full text-left cursor-pointer"
			type="button"
			onclick={() => openSettingsDialog()}
		>
			<Icon name="settings" class="w-4 h-4 shrink-0" />
			{t('sidebar.settings')}
		</button>
		<p class="text-center text-[10px] text-surface-400-600 select-none">{version}</p>
	</div>
{/if}
