<script lang="ts">
	const PADDING_CLASS = {
		sm: 'p-3 md:p-4',
		md: 'p-3 md:p-4 lg:p-6',
		lg: 'p-8',
		none: '',
	} as const;

	const GAP_CLASS = {
		sm: 'space-y-2',
		md: 'space-y-3',
		lg: 'space-y-4',
		none: '',
	} as const;

	interface Props {
		title?: string;
		description?: string;
		padding?: keyof typeof PADDING_CLASS;
		gap?: keyof typeof GAP_CLASS;
		class?: string;
		children: import('svelte').Snippet;
	}

	let { title, description, padding = 'md', gap = 'lg', class: extraClass = '', children }: Props = $props();

	let className = $derived(`card ${PADDING_CLASS[padding]} ${GAP_CLASS[gap]}${extraClass ? ' ' + extraClass : ''}`);
</script>

<section class={className}>
	{#if title}
		<h2 class="h4">{title}</h2>
	{/if}
	{#if description}
		<span class="text-xs text-surface-500">{description}</span>
	{/if}
	{@render children()}
</section>
