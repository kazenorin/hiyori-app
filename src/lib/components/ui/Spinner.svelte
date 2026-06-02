<script lang="ts">
	const SIZE_CLASS = {
		xs: 'w-3 h-3 border-2',
		md: 'w-6 h-6 border-3',
		lg: 'w-8 h-8 border-4',
		xl: 'w-10 h-10 border-4',
	} as const;

	interface Props {
		size?: keyof typeof SIZE_CLASS;
		class?: string;
	}

	let { size = 'md', class: extraClass = '' }: Props = $props();
</script>

<div
	class="inline-block border-surface-200-800 border-t-primary-500 rounded-full animate-spin {SIZE_CLASS[size]}{extraClass
		? ' ' + extraClass
		: ''}"
></div>
