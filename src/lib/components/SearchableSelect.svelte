<script lang="ts">
	import Modal from '#lib/components/ui/Modal.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';

	interface Props {
		items: { label: string; value: string }[];
		value: string;
		onValueChange: (value: string) => void;
		title: string;
		searchPlaceholder: string;
		emptyText: string;
		disabled?: boolean;
		placeholder?: string;
	}

	let { items, value, onValueChange, title, searchPlaceholder, emptyText, disabled = false, placeholder = '' }: Props = $props();

	let pickerOpen = $state(false);
	let searchQuery = $state('');

	const selectedLabel = $derived(items.find((item) => item.value === value)?.label ?? '');
	const filteredItems = $derived(
		searchQuery.trim() ? items.filter((item) => item.label.toLowerCase().includes(searchQuery.trim().toLowerCase())) : items
	);

	function handleOpen() {
		searchQuery = '';
		pickerOpen = true;
	}

	function handleSelect(selected: string) {
		onValueChange(selected);
		pickerOpen = false;
	}
</script>

<button
	type="button"
	class="mt-1 w-full min-h-11 px-4 rounded-lg border border-surface-200-800 bg-surface-50-950 hover:bg-surface-100-900 text-surface-950-50 text-sm text-left flex items-center justify-between gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
	{disabled}
	onclick={handleOpen}
>
	<span class="truncate" class:opacity-50={!selectedLabel}>{selectedLabel || placeholder}</span>
	<Icon name="chevron-down" class="w-4 h-4 shrink-0 opacity-50" />
</button>

<Modal bind:open={pickerOpen} {title} width="lg" onclose={() => (pickerOpen = false)}>
	{#snippet body()}
		<input class="input w-full" type="search" placeholder={searchPlaceholder} bind:value={searchQuery} />
		<div class="mt-3 max-h-[60vh] overflow-y-auto space-y-2 pr-1">
			{#if filteredItems.length === 0}
				<p class="text-sm text-surface-500 text-center py-4">{emptyText}</p>
			{:else}
				{#each filteredItems as item (item.value)}
					<button
						type="button"
						class="w-full px-3 py-2 rounded-lg text-left text-sm transition-colors flex items-center justify-between gap-2 {value ===
						item.value
							? 'bg-primary-500/10 text-primary-500'
							: 'hover:bg-surface-200-800'}"
						onclick={() => handleSelect(item.value)}
					>
						<span class="truncate">{item.label}</span>
						<Icon name={value === item.value ? 'circle-dot' : 'circle'} class="w-4 h-4 shrink-0" />
					</button>
				{/each}
			{/if}
		</div>
	{/snippet}
</Modal>
