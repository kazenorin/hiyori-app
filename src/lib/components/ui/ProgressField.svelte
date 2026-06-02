<script lang="ts">
	import { Progress } from '@skeletonlabs/skeleton-svelte';

	interface Props {
		value: number;
		label: string;
		visible: boolean;
	}

	let { value, label, visible }: Props = $props();
</script>

{#if visible}
	<Progress {value} class="mt-2">
		<Progress.Track>
			<Progress.Range />
		</Progress.Track>
	</Progress>
	<span class="text-xs text-surface-500">{label}</span>
{/if}
