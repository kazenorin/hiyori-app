<script lang="ts" generics="T extends string">
	import { Combobox, Portal, useListCollection } from '@skeletonlabs/skeleton-svelte';

	interface Props {
		items: { label: string; value: T }[];
		value: T;
		onValueChange: (value: T) => void;
		disabled?: boolean;
		placeholder?: string;
	}

	let { items, value, onValueChange, disabled = false, placeholder = '' }: Props = $props();

	const collection = $derived(
		useListCollection({
			items,
			itemToString: (item: { label: string; value: T }) => item.label,
			itemToValue: (item: { label: string; value: T }) => item.value,
		})
	);

	const comboboxValue = $derived(value ? [value] : []);

	function handleValueChange(details: { value: string[] }) {
		// Resolve back to the typed item value; the combobox only emits values from `items`
		const selected = items.find((item) => item.value === details.value[0]);
		if (selected) {
			onValueChange(selected.value);
		}
	}
</script>

<Combobox class="mt-1" {collection} value={comboboxValue} onValueChange={handleValueChange} {disabled} {placeholder} openOnClick>
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
