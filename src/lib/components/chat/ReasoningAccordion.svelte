<script lang="ts">
	import { Accordion } from '@skeletonlabs/skeleton-svelte';

	interface Props {
		label: string;
		value: string;
		children: import('svelte').Snippet;
	}

	let { label, value, children }: Props = $props();
</script>

<div class="mb-3">
	<Accordion collapsible>
		<Accordion.Item {value}>
			<Accordion.ItemTrigger class="flex items-center justify-between w-full text-xs font-medium text-surface-500 py-1">
				<span>{label}</span>
				<Accordion.ItemIndicator>
					<span class="transition-transform duration-150 text-surface-500">&#9660;</span>
				</Accordion.ItemIndicator>
			</Accordion.ItemTrigger>
			<Accordion.ItemContent>
				{#snippet element(attributes)}
					{#if !attributes.hidden}
						<div
							{...attributes}
							class="text-xs text-surface-500 leading-relaxed whitespace-pre-wrap border-l-2 border-surface-200-800 pl-3 mt-2"
						>
							{@render children()}
						</div>
					{/if}
				{/snippet}
			</Accordion.ItemContent>
		</Accordion.Item>
	</Accordion>
</div>
