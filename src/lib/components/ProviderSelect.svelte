<script lang="ts">
	import { t } from '$lib/i18n';
	import { settings } from '$lib/stores/settings.svelte';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

	interface Props {
		items: { label: string; value: string }[];
		value: string;
		onValueChange: (value: string) => void;
		disabled?: boolean;
		placeholder?: string;
	}

	let { items, value, onValueChange, disabled = false, placeholder = '' }: Props = $props();

	// Above this provider count, a searchable dialog replaces the themed select
	const PROVIDER_DIALOG_THRESHOLD = 5;

	let pickerOpen = $state(false);
	let searchQuery = $state('');

	const useDialog = $derived(settings.providers.length > PROVIDER_DIALOG_THRESHOLD);
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

{#if useDialog}
	<button
		type="button"
		class="mt-1 w-full min-h-11 px-4 rounded-lg border border-surface-200-800 bg-surface-50-950 hover:bg-surface-100-900 text-surface-950-50 text-sm text-left flex items-center justify-between gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
		{disabled}
		onclick={handleOpen}
	>
		<span class="truncate" class:opacity-50={!selectedLabel}>{selectedLabel || placeholder}</span>
		<Icon name="chevron-down" class="w-4 h-4 shrink-0 opacity-50" />
	</button>

	<Modal bind:open={pickerOpen} title={t('settings.chooseProvider')} width="lg" onclose={() => (pickerOpen = false)}>
		{#snippet body()}
			<input class="input w-full" type="search" placeholder={t('settings.searchProviders')} bind:value={searchQuery} />
			<div class="mt-3 max-h-[60vh] overflow-y-auto space-y-2 pr-1">
				{#if filteredItems.length === 0}
					<p class="text-sm text-surface-500 text-center py-4">{t('settings.noMatchingProviders')}</p>
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
{:else}
	<ThemedSelect {items} {value} {onValueChange} {disabled} {placeholder} />
{/if}
