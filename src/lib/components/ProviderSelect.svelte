<script lang="ts">
	import { t } from '#lib/i18n';
	import { settings } from '#lib/stores/settings.svelte';
	import ThemedSelect from '#lib/components/ThemedSelect.svelte';
	import SearchableSelect from '#lib/components/SearchableSelect.svelte';

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

	const useDialog = $derived(settings.providers.length > PROVIDER_DIALOG_THRESHOLD);
</script>

{#if useDialog}
	<SearchableSelect
		{items}
		{value}
		{onValueChange}
		{disabled}
		{placeholder}
		title={t('settings.chooseProvider')}
		searchPlaceholder={t('settings.searchProviders')}
		emptyText={t('settings.noMatchingProviders')}
	/>
{:else}
	<ThemedSelect {items} {value} {onValueChange} {disabled} {placeholder} />
{/if}
