<script lang="ts">
	import { t } from '$lib/i18n';
	import { version } from '$lib/app/version';
	import Sortable from 'sortablejs';
	import { setStoryOrder } from '$lib/stores/stories.svelte';
	import { getSettings, updateSettings } from '$lib/stores/settings.svelte';
	import type { Act } from '$lib/db/acts';
	import type { ActLineMeta } from '$lib/db/act-lines';
	import type { LineageGroupsResult } from '$lib/db/lineage-groups';
	import { deriveCollapsedGroups } from './collapsed-icons';
	import SidebarRowMenu from './SidebarRowMenu.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { resolve } from '$app/paths';
	import { canActBeDeleted, canActLineBeDeleted } from '$lib/db/acts';
	import { openSettingsDialog } from '$lib/features/settings/settings-dialog-state.svelte';

	interface Props {
		stories: { id: string; name: string }[];
		activeStoryId: string | null;
		activeActLineId: string | null;
		acts: Act[];
		storyActLines: ActLineMeta[];
		lineage: LineageGroupsResult | undefined;
		onSelectStory: (id: string) => void;
		onSelectActLine: (id: string) => void;
		onRequestDeleteStory: (id: string, name: string) => void;
		onStartRenameStory: (id: string, name: string) => void;
		onExportStory: (id: string) => void;
		onContextManagement: () => void;
		onNewStory: () => void;
		onToggleGroup: (storyId: string, value: boolean) => void;
		onRequestDeleteAct: (id: string, name: string) => void;
		onRequestDeleteActLine: (id: string, name: string) => void;
		onStartRenameAct: (id: string, name: string) => void;
		onStartRenameLine: (id: string, name: string) => void;
		groupByLine: boolean;
		onCloudSync: () => void;
		cloudSyncAvailable: boolean;
		cloudSyncBusy: boolean;
	}

	let {
		stories,
		activeStoryId,
		activeActLineId,
		acts,
		storyActLines,
		lineage,
		onSelectStory,
		onSelectActLine,
		onRequestDeleteStory,
		onStartRenameStory,
		onExportStory,
		onContextManagement,
		onNewStory,
		onToggleGroup,
		onRequestDeleteAct,
		onRequestDeleteActLine,
		onStartRenameAct,
		onStartRenameLine,
		groupByLine,
		onCloudSync,
		cloudSyncAvailable,
		cloudSyncBusy,
	}: Props = $props();

	let expandedGroupId = $state<string | null>(null);
	let menuStoryId = $state<string | null>(null);
	let menuGroupId = $state<string | null>(null);
	let menuLineId = $state<string | null>(null);

	const FONT_SIZE_MIN = 0.7;
	const FONT_SIZE_MAX = 1.5;
	const FONT_SIZE_STEP = 0.05;

	const fontSize = $derived(getSettings().fontSize);

	function stepFontSize(delta: number) {
		const next = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round((fontSize + delta) * 100) / 100));
		updateSettings({ fontSize: next });
	}

	let tip = $state<{ text: string; x: number; y: number } | null>(null);

	function showTip(target: EventTarget | null) {
		const el = target instanceof Element ? target.closest<HTMLElement>('[data-tip]') : null;
		if (!el?.dataset.tip) {
			tip = null;
			return;
		}
		const r = el.getBoundingClientRect();
		tip = {
			text: el.dataset.tip,
			x: r.right,
			y: Math.min(Math.max(r.top + r.height / 2, 14), window.innerHeight - 14),
		};
	}

	function handlePointerOver(e: PointerEvent) {
		showTip(e.target);
	}

	function handlePointerOut(e: PointerEvent) {
		const from = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
		const to = e.relatedTarget instanceof Element ? e.relatedTarget.closest('[data-tip]') : null;
		if (from !== to) tip = null;
	}

	function handleFocusIn(e: FocusEvent) {
		showTip(e.target);
	}

	const collapsedGroups = $derived(
		deriveCollapsedGroups({ acts, lines: storyActLines, lineage, groupByLine: groupByLine && (lineage?.toggleVisible ?? false) })
	);
	// Effective group-by-line state — same expression deriveCollapsedGroups consumes.
	const effectiveGroupByLine = $derived(groupByLine && (lineage?.toggleVisible ?? false));

	// Auto-expand the group containing the active act line; resets when the
	// story's data changes (collapsedGroups recomputes from props).
	$effect(() => {
		const auto = collapsedGroups.find((g) => g.lines.some((l) => l.lineId === activeActLineId))?.id ?? null;
		expandedGroupId = auto;
		menuStoryId = null;
		menuGroupId = null;
		menuLineId = null;
	});

	// --- Drag reordering of story icons (same persistence as expanded mode) ---
	let storyListEl = $state<HTMLDivElement | null>(null);
	let sortable: Sortable | null = null;

	$effect(() => {
		if (storyListEl && !sortable) {
			sortable = Sortable.create(storyListEl, {
				animation: 150,
				delay: 300,
				delayOnTouchOnly: true,
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
</script>

<svelte:window
	onpointerover={handlePointerOver}
	onpointerout={handlePointerOut}
	onpointerdown={() => (tip = null)}
	onfocusin={handleFocusIn}
	onfocusout={() => (tip = null)}
/>

{#if tip}
	<div
		class="pointer-events-none fixed z-50 max-w-60 -translate-y-1/2 rounded-lg border border-surface-200-800 bg-surface-100-900 px-2 py-1 text-xs text-surface-700-300 shadow-md"
		style:left="{tip.x + 12}px"
		style:top="{tip.y}px"
	>
		<span class="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 border-b border-l border-surface-200-800 bg-surface-100-900"
		></span>
		{tip.text}
	</div>
{/if}

<div class="flex-1 overflow-y-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
	<button
		class="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg text-surface-500 hover:bg-surface-200-800 hover:text-surface-700-300 cursor-pointer"
		type="button"
		aria-label={t('sidebar.expandSidebar')}
		data-tip={t('sidebar.expandSidebar')}
		onclick={() => updateSettings({ sidebarCollapsed: false })}
	>
		<Icon name="panel-left-open" class="h-5 w-5" />
	</button>

	<button
		class="mx-auto mb-1 flex h-10 w-10 items-center justify-center rounded-lg text-surface-500 hover:bg-surface-200-800 hover:text-surface-700-300 cursor-pointer"
		type="button"
		aria-label={t('sidebar.newStory')}
		data-tip={t('sidebar.newStory')}
		onclick={onNewStory}
	>
		<Icon name="plus" class="h-5 w-5" />
	</button>
	<a
		class="mx-auto mb-1 flex h-10 w-10 items-center justify-center rounded-lg text-surface-500 hover:bg-surface-200-800 hover:text-surface-700-300"
		href={resolve('/load-story')}
		aria-label={t('sidebar.loadStory')}
		data-tip={t('sidebar.loadStory')}
	>
		<Icon name="hard-drive-upload" class="h-5 w-5" />
	</a>

	<div bind:this={storyListEl} class="space-y-1">
		{#each stories as story (story.id)}
			{@const isActiveStory = activeStoryId === story.id}
			<div class="relative" data-story-id={story.id}>
				<button
					class="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border text-sm font-medium cursor-pointer {isActiveStory
						? 'border-primary-500 bg-primary-100-900 text-primary-700-300'
						: 'border-surface-200-800 bg-surface-100-900 text-surface-700-300'} hover:bg-surface-200-800"
					type="button"
					aria-label={story.name}
					data-tip={story.name}
					onclick={() => onSelectStory(story.id)}
					oncontextmenu={(e) => {
						e.preventDefault();
						// Only one context menu at a time across story/group/line slots.
						menuGroupId = null;
						menuLineId = null;
						menuStoryId = story.id;
					}}
				>
					{[...story.name.trim()][0] ?? '?'}
				</button>
				<SidebarRowMenu
					kind="story"
					canDelete
					hiddenTrigger
					placement="right-start"
					open={menuStoryId === story.id}
					onOpenChange={(o) => (menuStoryId = o ? story.id : null)}
					showGroupToggle={lineage?.toggleVisible ?? false}
					{groupByLine}
					onEdit={() => onStartRenameStory(story.id, story.name)}
					onDelete={() => onRequestDeleteStory(story.id, story.name)}
					onExport={() => onExportStory(story.id)}
					{onContextManagement}
					onToggleGroup={(v) => onToggleGroup(story.id, v)}
				/>

				{#if isActiveStory && collapsedGroups.length > 0}
					<!-- Selected-story bounding rectangle -->
					<div class="mx-auto mt-1 w-11 rounded-lg bg-surface-200-800 p-1">
						{#each collapsedGroups as group (group.id)}
							<div class="relative flex flex-col items-center gap-1 py-0.5">
								<button
									class="relative flex h-7 w-7 items-center justify-center rounded-md text-xs font-medium text-surface-700-300 hover:bg-surface-300-700 cursor-pointer"
									type="button"
									aria-label={group.tooltip}
									data-tip={group.tooltip}
									onclick={() => (expandedGroupId = expandedGroupId === group.id ? null : group.id)}
									oncontextmenu={(e) => {
										e.preventDefault();
										// Only one context menu at a time across story/group/line slots.
										menuStoryId = null;
										menuLineId = null;
										menuGroupId = group.id;
									}}
								>
									{group.label}
									{#if group.badge !== undefined}
										<span
											class="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error-500 px-0.5 text-[9px] font-semibold text-white"
										>
											{group.badge}
										</span>
									{/if}
								</button>
								{#if !effectiveGroupByLine}
									{@const act = acts.find((a) => a.id === group.id)}
									{#if act}
										<SidebarRowMenu
											kind="act"
											canDelete={canActBeDeleted(act, acts, storyActLines)}
											hiddenTrigger
											placement="right-start"
											open={menuGroupId === group.id}
											onOpenChange={(o) => (menuGroupId = o ? group.id : null)}
											showGroupToggle={lineage?.toggleVisible ?? false}
											{groupByLine}
											onEdit={() => onStartRenameAct(act.id, act.name)}
											onDelete={() => onRequestDeleteAct(act.id, act.name)}
											onExport={() => {
												if (activeStoryId) onExportStory(activeStoryId);
											}}
											{onContextManagement}
											onToggleGroup={(v) => {
												if (activeStoryId) onToggleGroup(activeStoryId, v);
											}}
										/>
									{/if}
								{:else}
									<SidebarRowMenu
										kind="group"
										canDelete={false}
										hiddenTrigger
										placement="right-start"
										open={menuGroupId === group.id}
										onOpenChange={(o) => (menuGroupId = o ? group.id : null)}
										showGroupToggle={lineage?.toggleVisible ?? false}
										{groupByLine}
										onEdit={() => {}}
										onDelete={() => {}}
										onExport={() => {
											if (activeStoryId) onExportStory(activeStoryId);
										}}
										{onContextManagement}
										onToggleGroup={(v) => {
											if (activeStoryId) onToggleGroup(activeStoryId, v);
										}}
									/>
								{/if}
								{#if expandedGroupId === group.id}
									<!-- Selected-group bounding rectangle -->
									<div class="flex flex-col items-center gap-1 rounded-md bg-surface-300-700 p-1">
										{#each group.lines as line (line.lineId)}
											{@const lineMeta = storyActLines.find((l) => l.id === line.lineId)}
											{@const lineAct = lineMeta ? acts.find((a) => a.id === lineMeta.actId) : undefined}
											{@const canDeleteLine =
												lineMeta && lineAct
													? (lineAct.actNumber !== 1 || storyActLines.filter((l) => l.actId === lineMeta.actId).length > 1) &&
														canActLineBeDeleted(line.lineId, acts)
													: false}
											<div class="relative">
												<button
													class="flex h-7 w-7 items-center justify-center rounded-md text-xs cursor-pointer {activeActLineId === line.lineId
														? 'bg-primary-100-900 font-semibold text-primary-700-300'
														: 'text-surface-600-400 hover:bg-surface-200-800'}"
													type="button"
													aria-label={line.tooltip}
													data-tip={line.tooltip}
													onclick={() => onSelectActLine(line.lineId)}
													oncontextmenu={(e) => {
														e.preventDefault();
														// Only one context menu at a time across story/group/line slots.
														menuStoryId = null;
														menuGroupId = null;
														menuLineId = line.lineId;
													}}
												>
													{line.label}
												</button>
												<SidebarRowMenu
													kind="line"
													canDelete={canDeleteLine}
													hiddenTrigger
													placement="right-start"
													open={menuLineId === line.lineId}
													onOpenChange={(o) => (menuLineId = o ? line.lineId : null)}
													showGroupToggle={lineage?.toggleVisible ?? false}
													{groupByLine}
													onEdit={() => onStartRenameLine(line.lineId, lineMeta?.name ?? '')}
													onDelete={() => onRequestDeleteActLine(line.lineId, lineMeta?.name ?? '')}
													onExport={() => {
														if (activeStoryId) onExportStory(activeStoryId);
													}}
													{onContextManagement}
													onToggleGroup={(v) => {
														if (activeStoryId) onToggleGroup(activeStoryId, v);
													}}
												/>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<div class="flex flex-col items-center gap-1 border-t border-surface-200-800 p-1">
	<button
		class="flex h-10 w-10 items-center justify-center rounded-lg text-surface-500 hover:bg-surface-200-800 hover:text-surface-700-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed [@media(max-height:519px)]:hidden"
		type="button"
		aria-label={t('sidebar.zoomIn')}
		data-tip={t('sidebar.zoomIn')}
		disabled={fontSize >= FONT_SIZE_MAX}
		onclick={() => stepFontSize(FONT_SIZE_STEP)}
	>
		<Icon name="zoom-in" class="h-5 w-5" />
	</button>
	<button
		class="flex h-10 w-10 items-center justify-center rounded-lg text-surface-500 hover:bg-surface-200-800 hover:text-surface-700-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed [@media(max-height:519px)]:hidden"
		type="button"
		aria-label={t('sidebar.zoomOut')}
		data-tip={t('sidebar.zoomOut')}
		disabled={fontSize <= FONT_SIZE_MIN}
		onclick={() => stepFontSize(-FONT_SIZE_STEP)}
	>
		<Icon name="zoom-out" class="h-5 w-5" />
	</button>
	{#if cloudSyncAvailable}
		<button
			class="flex h-10 w-10 items-center justify-center rounded-lg text-surface-500 hover:bg-surface-200-800 hover:text-surface-700-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
			type="button"
			aria-label={t('sidebar.syncToCloud')}
			data-tip={cloudSyncBusy ? t('cloudSync.syncing') : t('sidebar.syncToCloud')}
			disabled={!activeStoryId || cloudSyncBusy}
			onclick={onCloudSync}
		>
			<Icon name="cloud-sync" class="h-5 w-5" />
		</button>
	{/if}
	<a
		class="flex h-10 w-10 items-center justify-center rounded-lg text-surface-500 hover:bg-surface-200-800 hover:text-surface-700-300 [@media(max-height:431px)]:hidden"
		href={resolve('/file-manager')}
		aria-label={t('sidebar.fileManager')}
		data-tip={t('sidebar.fileManager')}
	>
		<Icon name="folder-cog" class="h-5 w-5" />
	</a>
	<button
		class="flex h-10 w-10 items-center justify-center rounded-lg text-surface-500 hover:bg-surface-200-800 hover:text-surface-700-300 cursor-pointer [@media(max-height:431px)]:hidden"
		type="button"
		aria-label={t('sidebar.settings')}
		data-tip={t('sidebar.settings')}
		onclick={() => openSettingsDialog()}
	>
		<Icon name="settings" class="h-5 w-5" />
	</button>
	<p class="text-center text-[10px] text-surface-400-600 select-none">{version}</p>
</div>
