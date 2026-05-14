<script lang="ts">
	import { Combobox, Portal, useListCollection } from '@skeletonlabs/skeleton-svelte';

	interface Props {
		items: { label: string; value: string }[];
		value: string;
		onValueChange: (value: string) => void;
		disabled?: boolean;
		placeholder?: string;
	}

	let { items, value, onValueChange, disabled = false, placeholder = '' }: Props = $props();

	const collection = $derived(
		useListCollection({
			items,
			itemToString: (item: { label: string; value: string }) => item.label,
			itemToValue: (item: { label: string; value: string }) => item.value,
		}),
	);

	const comboboxValue = $derived(value ? [value] : []);

	function handleValueChange(details: { value: string[] }) {
		if (details.value.length > 0) {
			onValueChange(details.value[0]);
		}
	}
</script>

<Combobox
	class="mt-1"
	{collection}
	value={comboboxValue}
	onValueChange={handleValueChange}
	{disabled}
	{placeholder}
	openOnClick
>
	<Combobox.Control>
		<Combobox.Input readonly tabindex={-1} />
		<Combobox.Trigger />
	</Combobox.Control>
	<Portal>
		<Combobox.Positioner>
			<Combobox.Content>
				{#each items as item (item.value)}
					<Combobox.Item {item}>
						<Combobox.ItemText>{item.label}</Combobox.ItemText>
						<Combobox.ItemIndicator />
					</Combobox.Item>
				{/each}
			</Combobox.Content>
		</Combobox.Positioner>
	</Portal>
</Combobox>
