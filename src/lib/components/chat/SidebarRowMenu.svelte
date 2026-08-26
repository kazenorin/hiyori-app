<script lang="ts">
	import { t } from '$lib/i18n';
	import { Popover, Portal, Switch } from '@skeletonlabs/skeleton-svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

	interface Props {
		kind: 'story' | 'act' | 'line' | 'group';
		canDelete: boolean;
		showGroupToggle: boolean;
		groupByLine: boolean;
		onEdit: () => void;
		onDelete: () => void;
		onExport: () => void;
		onContextManagement: () => void;
		onToggleGroup: (value: boolean) => void;
		/** Controlled open state; when omitted the trigger button manages it. */
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		/** Anchor placement; 'right-start' is used by the collapsed sidebar. */
		placement?: 'bottom-start' | 'right-start';
		/** Hide the ellipsis trigger and anchor to an invisible point at the parent's top-right corner instead. */
		hiddenTrigger?: boolean;
	}

	let {
		kind,
		canDelete,
		showGroupToggle,
		groupByLine,
		onEdit,
		onDelete,
		onExport,
		onContextManagement,
		onToggleGroup,
		open,
		onOpenChange,
		placement = 'bottom-start',
		hiddenTrigger = false,
	}: Props = $props();

	const ITEM_CLASS =
		'w-full flex items-center gap-2 px-3 py-2 text-sm text-surface-700-300 hover:bg-surface-200-800 transition-colors duration-150 cursor-pointer text-left';

	const editLabel = $derived(
		kind === 'story' ? t('sidebar.renameStory') : kind === 'act' ? t('sidebar.renameAct') : t('sidebar.renameLine')
	);
	const deleteLabel = $derived(
		kind === 'story' ? t('sidebar.deleteStory') : kind === 'act' ? t('sidebar.deleteAct') : t('sidebar.deleteLine')
	);

	const positioning = $derived(
		placement === 'bottom-start'
			? { placement: 'bottom-start' as const, gutter: 4, offset: { crossAxis: -8 } }
			: { placement, gutter: 4 }
	);
	// zag reports open changes as a details object; adapt to this component's boolean callback.
	const popoverControl = $derived(
		open === undefined ? {} : { open, onOpenChange: (details: { open: boolean }) => onOpenChange?.(details.open) }
	);
</script>

<Popover {...popoverControl} {positioning}>
	{#if hiddenTrigger}
		<Popover.Trigger class="absolute top-0 right-0 h-px w-px opacity-0 pointer-events-none" tabindex={-1} aria-hidden="true" />
	{:else}
		<Popover.Trigger
			class="p-1 rounded-md text-surface-500 hover:text-surface-700-300 group-hover:text-surface-700-300 shrink-0 cursor-pointer"
			aria-label={t('sidebar.moreActions')}
			title={t('sidebar.moreActions')}
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<Icon name="ellipsis-vertical" class="w-4 h-4" />
		</Popover.Trigger>
	{/if}
	<Portal>
		<Popover.Positioner class="z-50">
		<Popover.Content class="w-56 py-1 rounded-lg bg-surface-100-900 border border-surface-200-800 shadow-xl">
		{#if showGroupToggle}
			<Switch
				checked={groupByLine}
				onCheckedChange={({ checked }) => onToggleGroup(checked)}
				class="flex items-center justify-between w-full px-3 py-2 cursor-pointer outline-none! has-[:focus-visible]:[&>[data-part=control]]:ring-2 has-[:focus-visible]:[&>[data-part=control]]:ring-primary-500"
			>
				<Switch.Label class="flex items-center gap-2 text-sm text-surface-700-300">
					<Icon name="fork" class="w-4 h-4" />
					{t('sidebar.groupByActLine')}
				</Switch.Label>
				<Switch.Control class="data-[state=checked]:bg-primary-500 h-4! w-7!">
					<Switch.Thumb class="data-[state=checked]:[transform:translateX(12px)]!" />
				</Switch.Control>
				<Switch.HiddenInput />
			</Switch>
		{/if}
		<Popover.CloseTrigger class={ITEM_CLASS} type="button" onclick={onExport}>
			<Icon name="download" class="w-4 h-4" />
			<span>{t('sidebar.exportStory')}</span>
		</Popover.CloseTrigger>
		{#if kind !== 'group'}
			<Popover.CloseTrigger class={ITEM_CLASS} type="button" onclick={onEdit}>
				<Icon name="edit" class="w-4 h-4" />
				<span>{editLabel}</span>
			</Popover.CloseTrigger>
		{/if}
		{#if kind === 'line'}
			<Popover.CloseTrigger class={ITEM_CLASS} type="button" onclick={onContextManagement}>
				<Icon name="file-box" class="w-4 h-4" />
				<span>{t('sidebar.contextManagement')}</span>
			</Popover.CloseTrigger>
		{/if}
		{#if kind !== 'group'}
			<Popover.CloseTrigger
				class="{ITEM_CLASS} text-error-500 disabled:opacity-30 disabled:cursor-not-allowed"
				type="button"
				disabled={!canDelete}
				onclick={onDelete}
			>
				<Icon name="trash" class="w-4 h-4" />
				<span>{deleteLabel}</span>
			</Popover.CloseTrigger>
		{/if}
	</Popover.Content>
		</Popover.Positioner>
	</Portal>
</Popover>
