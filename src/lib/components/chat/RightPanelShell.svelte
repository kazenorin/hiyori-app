<script lang="ts">
	import { t } from '$lib/i18n';
	import { clamp } from 'lodash-es';
	import type { Snippet } from 'svelte';
	import { getSettings, updateSettings } from '$lib/stores/settings.svelte';
	import { RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH, RIGHT_PANEL_COLLAPSED_WIDTH } from '$lib/components/chat/panel-limits';
	import Icon from '$lib/components/ui/Icon.svelte';

	interface Props {
		label: string;
		/** Director-notes count shown as a badge on the collapsed strip. */
		notesCount?: number;
		/** Hide the panel below lg (main chat). The World Builder panel stays visible at all tiers. */
		mobileHidden?: boolean;
		headerExtra?: Snippet;
		children: Snippet;
	}

	let { label, notesCount = 0, mobileHidden = true, headerExtra, children }: Props = $props();

	// md accordion behavior (pre-existing, unchanged)
	let rightPanelExpanded = $state(true);
	let liveWidth = $state<number | null>(null);

	const collapsed = $derived(getSettings().rightPanelCollapsed);
	const widthPx = $derived(liveWidth ?? getSettings().rightPanelWidth);

	function handleResizeStart(e: PointerEvent) {
		e.preventDefault();
		const startX = e.clientX;
		const startWidth = widthPx;
		const onMove = (ev: PointerEvent) => {
			// Panel sits on the right: dragging left grows it.
			liveWidth = clamp(startWidth + (startX - ev.clientX), RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH);
		};
		const onUp = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			if (liveWidth !== null) updateSettings({ rightPanelWidth: liveWidth });
			liveWidth = null;
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}
</script>

<aside
	class="relative {mobileHidden
		? 'hidden md:flex'
		: 'flex'} border-t lg:border-t-0 lg:border-l border-surface-200-800 flex-col bg-surface-50-950 shrink-0 lg:w-(--panel-width) {rightPanelExpanded
		? 'max-h-none'
		: 'lg:max-h-none max-h-10'}"
	style="--panel-width: {collapsed ? RIGHT_PANEL_COLLAPSED_WIDTH : widthPx}px"
>
	<!-- Mobile/tablet toggle bar (unchanged behavior) -->
	<button
		class="lg:hidden flex w-full items-center justify-between px-3 py-2 text-xs text-surface-500 hover:bg-surface-100-900 transition-colors"
		type="button"
		aria-expanded={rightPanelExpanded}
		onclick={() => (rightPanelExpanded = !rightPanelExpanded)}
	>
		<span class="font-medium text-surface-500 uppercase tracking-wider">{label}</span>
		<Icon name="chevron-down" class="h-4 w-4 transition-transform {rightPanelExpanded ? 'rotate-180' : ''}" />
	</button>

	{#if collapsed}
		<!-- lg collapsed strip -->
		<div class="hidden lg:flex flex-col items-center gap-3 py-3">
			<button
				class="text-surface-500 hover:text-surface-700-300 cursor-pointer"
				type="button"
				aria-label={t('sidebar.expandPanel')}
				title={t('sidebar.expandPanel')}
				onclick={() => updateSettings({ rightPanelCollapsed: false })}
			>
				<Icon name="panel-right-open" class="h-5 w-5" />
			</button>
			{#if notesCount > 0}
				<button
					class="relative text-surface-500 hover:text-surface-700-300 cursor-pointer"
					type="button"
					aria-label={t('sidebar.directorNotes')}
					title={t('sidebar.directorNotes')}
					onclick={() => updateSettings({ rightPanelCollapsed: false })}
				>
					<Icon name="sticky-note" class="h-5 w-5" />
					<span
						class="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-error-500 px-0.5 text-[9px] font-semibold text-white"
					>
						{notesCount}
					</span>
				</button>
			{/if}
		</div>
	{/if}

	<!-- Panel content. When collapsed: visible at md only (lg collapse is a desktop-only state). -->
	<div class="{collapsed ? 'hidden md:flex lg:hidden' : 'flex'} flex-1 flex-col min-h-0 p-3 lg:p-4">
		<div class="hidden lg:flex items-center gap-2 mb-3">
			<button
				class="text-surface-500 hover:text-surface-700-300 cursor-pointer shrink-0"
				type="button"
				aria-label={t('sidebar.collapsePanel')}
				title={t('sidebar.collapsePanel')}
				onclick={() => updateSettings({ rightPanelCollapsed: true })}
			>
				<Icon name="panel-right-close" class="h-4 w-4" />
			</button>
			<span class="flex-1 text-xs font-medium text-surface-500 uppercase tracking-wider">{label}</span>
			{#if headerExtra}
				{@render headerExtra()}
			{/if}
		</div>
		{@render children()}
	</div>

	{#if !collapsed}
		<!-- Resize handle (lg only) -->
		<div
			class="absolute inset-y-0 left-0 z-10 hidden lg:block w-1.5 cursor-col-resize hover:bg-primary-500/30"
			role="separator"
			aria-orientation="vertical"
			onpointerdown={handleResizeStart}
		></div>
	{/if}
</aside>
