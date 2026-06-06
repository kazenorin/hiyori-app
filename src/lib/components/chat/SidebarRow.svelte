<script lang="ts">
	import type { Snippet } from 'svelte';
	import { swipeable, type SwipeEndEventDetail } from '@svelte-put/swipeable';
	import { Pencil, Trash2 } from '@lucide/svelte';
	import RenameInput from './RenameInput.svelte';

	interface Props {
		rowId: string;
		variant: 'desktop' | 'mobile';
		isActive: boolean;
		isEditing: boolean;
		size: 'sm' | 'xs';
		indent?: 'none' | 'pl-4' | 'pl-8';
		activeClass: string;
		// Value of the inline rename input. Ignored when isEditing is false.
		renameValue: string;
		// Whether to show the delete button (desktop hover button + mobile swipe).
		// Some rows (e.g. non-last acts) cannot be deleted.
		canDelete: boolean;
		// Mobile-only
		swipeConfig: Parameters<typeof swipeable>[1];
		isOpen: boolean;
		openOffset: number;
		// Labels
		renameAriaLabel: string;
		deleteAriaLabel: string;
		// Callbacks
		onSelect: () => void;
		onRequestDelete: () => void;
		onStartRename: () => void;
		onSubmitRename: () => void;
		onCancelRename: () => void;
		onSwipeEnd: (e: CustomEvent<SwipeEndEventDetail>) => void;
		onContentClick: (e: Event) => void;
		onMobileAction: (rowId: string, action: () => void) => (e: Event) => void;
		onDismissOpen: () => void;
		// Trailing-click suppression
		justSwipedRowId: string | null;
		setJustSwiped: (id: string | null) => void;
		// Body
		children: Snippet;
	}

	let {
		rowId,
		variant,
		isActive,
		isEditing,
		size,
		indent = 'none',
		activeClass,
		renameValue = $bindable(''),
		canDelete = true,
		swipeConfig,
		isOpen,
		openOffset,
		renameAriaLabel,
		deleteAriaLabel,
		onSelect,
		onRequestDelete,
		onStartRename,
		onSubmitRename,
		onCancelRename,
		onSwipeEnd,
		onContentClick,
		onMobileAction,
		onDismissOpen,
		justSwipedRowId,
		setJustSwiped,
		children,
	}: Props = $props();

	const SIZE_CLASS = $derived(size === 'sm' ? 'text-sm' : 'text-xs');
	const HOVER_CLASS = $derived(
		`group flex items-center justify-between ${SIZE_CLASS} ${indentClass(indent)} rounded-(--radius-base) transition-colors duration-150 cursor-pointer`
	);

	function indentClass(indent: 'none' | 'pl-4' | 'pl-8'): string {
		if (indent === 'pl-4') return 'p-2 pl-4';
		if (indent === 'pl-8') return 'p-2 pl-8';
		return 'p-3';
	}
</script>

{#if variant === 'desktop'}
	<div class="{HOVER_CLASS} {isActive ? activeClass : 'hover:bg-surface-200-800'}" onclick={onSelect}>
		{#if isEditing}
			<RenameInput bind:value={renameValue} {size} onSubmit={onSubmitRename} onCancel={onCancelRename} />
		{:else}
			{@render children()}
			<button
				class="text-surface-500 hover:text-surface-700-300 ml-3 md:ml-2 transition-opacity text-xs shrink-0 w-9 h-9 md:w-auto md:h-auto flex items-center justify-center rounded-md {isActive
					? 'opacity-100'
					: 'opacity-0 group-hover:opacity-100'}"
				type="button"
				onclick={(e) => {
					e.stopPropagation();
					onStartRename();
				}}
				title={renameAriaLabel}>&#9998;</button
			>
		{/if}
		<button
			class="text-surface-500 hover:text-error-500 ml-2 md:ml-1 transition-opacity text-xs shrink-0 w-9 h-9 md:w-auto md:h-auto flex items-center justify-center rounded-md {isActive
				? 'opacity-100'
				: 'opacity-0 group-hover:opacity-100'} disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-surface-500"
			type="button"
			disabled={!canDelete}
			aria-label={deleteAriaLabel}
			onclick={(e) => {
				e.stopPropagation();
				onRequestDelete();
			}}
			title={deleteAriaLabel}>&times;</button
		>
	</div>
{:else}
	<div
		class="relative overflow-hidden w-full select-none touch-pan-y"
		use:swipeable={swipeConfig}
		data-swipe-row={rowId}
		onswipeend={onSwipeEnd}
	>
		{#if isOpen && openOffset < 0}
			<button
				class="btn preset-filled-error-500 text-white absolute inset-y-0 right-0 w-[100px] p-0 border-0 rounded-none disabled:opacity-50 disabled:cursor-not-allowed"
				type="button"
				aria-label={deleteAriaLabel}
				disabled={!canDelete}
				onclick={onMobileAction(rowId, onRequestDelete)}
			>
				<Trash2 size={20} />
			</button>
		{/if}
		{#if isOpen && openOffset > 0}
			<button
				class="btn preset-filled-secondary-500 text-white absolute inset-y-0 left-0 w-[100px] p-0 border-0 rounded-none"
				type="button"
				aria-label={renameAriaLabel}
				onclick={onMobileAction(rowId, onStartRename)}
			>
				<Pencil size={20} />
			</button>
		{/if}
		<div
			class="relative bg-surface-50-950 transition-transform duration-200"
			style:transform="translateX({isOpen ? openOffset : 0}px)"
			onclick={onContentClick}
		>
			<div
				class="{HOVER_CLASS} {isActive ? activeClass : 'hover:bg-surface-200-800'}"
				onclick={(e) => {
					if (justSwipedRowId === rowId) {
						// Trailing click from a swipe-end gesture; consume the
						// flag and stop propagation so the row stays open.
						e.stopPropagation();
						setJustSwiped(null);
						return;
					}
					if (isOpen) {
						onDismissOpen();
						return;
					}
					onSelect();
				}}
			>
				{#if isEditing}
					<RenameInput bind:value={renameValue} {size} onSubmit={onSubmitRename} onCancel={onCancelRename} />
				{:else}
					{@render children()}
				{/if}
			</div>
		</div>
	</div>
{/if}
