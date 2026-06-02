<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';

	const SIZE_CLASS = {
		'size-3': 'size-3',
		'size-4': 'size-4',
		'size-5': 'size-5',
	} as const;

	interface Props {
		type: 'story' | 'config' | 'default';
		size?: keyof typeof SIZE_CLASS;
	}

	let { type, size = 'size-4' }: Props = $props();
</script>

{#if type === 'story'}
	<Icon name="book" class={SIZE_CLASS[size]} />
{:else if type === 'config'}
	<Icon name="cog" class={SIZE_CLASS[size]} />
{:else}
	<Icon name="folder" class={SIZE_CLASS[size]} />
{/if}
