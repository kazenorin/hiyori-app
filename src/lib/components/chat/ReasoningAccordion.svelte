<script lang="ts">
	import { Accordion } from '@skeletonlabs/skeleton-svelte';

	interface Props {
		label: string;
		value: string;
		/** Drops the quoted-dialog border styling (used for phase output bodies). */
		plain?: boolean;
		children: import('svelte').Snippet;
	}

	let { label, value, plain = false, children }: Props = $props();
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
							class="text-xs text-surface-500 leading-relaxed whitespace-pre-wrap mt-2 {plain
								? ''
								: 'border-l-2 border-surface-200-800 pl-3'}"
						>
							{@render children()}
						</div>
					{/if}
				{/snippet}
			</Accordion.ItemContent>
		</Accordion.Item>
	</Accordion>
</div>
