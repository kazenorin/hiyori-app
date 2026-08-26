<script lang="ts">
	import { t } from '$lib/i18n';
	import { version } from '$lib/app/version';
	import Sortable from 'sortablejs';
	import { setStoryOrder } from '$lib/stores/stories.svelte';
	import { updateSettings } from '$lib/stores/settings.svelte';
	import type { Act } from '$lib/db/acts';
	import type { ActLineMeta } from '$lib/db/act-lines';
	import type { LineageGroupsResult } from '$lib/db/lineage-groups';
	import { deriveCollapsedGroups } from './collapsed-icons';
	import SidebarRowMenu from './SidebarRowMenu.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

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
		onToggleGroup: (storyId: string, value: boolean) => void;
		groupByLine: boolean;
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
		onToggleGroup,
		groupByLine,
	}: Props = $props();

	let expandedGroupId = $state<string | null>(null);
	let menuStoryId = $state<string | null>(null);

	const collapsedGroups = $derived(
		deriveCollapsedGroups({ acts, lines: storyActLines, lineage, groupByLine: groupByLine && (lineage?.toggleVisible ?? false) })
	);

	// Auto-expand the group containing the active act line; resets when the
	// story's data changes (collapsedGroups recomputes from props).
	$effect(() => {
		const auto = collapsedGroups.find((g) => g.lines.some((l) => l.lineId === activeActLineId))?.id ?? null;
		expandedGroupId = auto;
		menuStoryId = null;
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

<div class="flex-1 overflow-y-auto py-2">
	<button
		class="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg text-surface-500 hover:bg-surface-200-800 hover:text-surface-700-300 cursor-pointer"
		type="button"
		aria-label={t('sidebar.expandSidebar')}
		title={t('sidebar.expandSidebar')}
		onclick={() => updateSettings({ sidebarCollapsed: false })}
	>
		<Icon name="panel-left-open" class="h-5 w-5" />
	</button>

	<div bind:this={storyListEl} class="space-y-1">
		{#each stories as story (story.id)}
			{@const isActiveStory = activeStoryId === story.id}
			<div class="relative" data-story-id={story.id}>
				<button
					class="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border text-sm font-medium cursor-pointer {isActiveStory
						? 'border-primary-500 bg-primary-100-900 text-primary-700-300'
						: 'border-surface-200-800 bg-surface-100-900 text-surface-700-300'} hover:bg-surface-200-800"
					type="button"
					title={story.name}
					aria-label={story.name}
					onclick={() => onSelectStory(story.id)}
					oncontextmenu={(e) => {
						e.preventDefault();
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
							<div class="flex flex-col items-center gap-1 py-0.5">
								<button
									class="relative flex h-7 w-7 items-center justify-center rounded-md text-xs font-medium text-surface-700-300 hover:bg-surface-300-700 cursor-pointer"
									type="button"
									title={group.label}
									onclick={() => (expandedGroupId = expandedGroupId === group.id ? null : group.id)}
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
								{#if expandedGroupId === group.id}
									<!-- Selected-group bounding rectangle -->
									<div class="flex flex-col items-center gap-1 rounded-md bg-surface-300-700 p-1">
										{#each group.lines as line (line.lineId)}
											<button
												class="flex h-7 w-7 items-center justify-center rounded-md text-xs cursor-pointer {activeActLineId === line.lineId
													? 'bg-primary-100-900 font-semibold text-primary-700-300'
													: 'text-surface-600-400 hover:bg-surface-200-800'}"
												type="button"
												title={line.label}
												onclick={() => onSelectActLine(line.lineId)}
											>
												{line.label}
											</button>
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

<div class="border-t border-surface-200-800 p-1">
	<p class="text-center text-[10px] text-surface-400-600 select-none">{version}</p>
</div>
