<script lang="ts">
	const VARIANT_CLASS = {
		tonal: 'btn preset-tonal',
		filled: 'btn preset-filled',
		'filled-error': 'btn preset-filled-error-500',
		outline: 'btn preset-outlined',
		ghost: 'btn preset-ghost',
	} as const;

	const SIZE_CLASS = {
		sm: 'btn-sm',
		md: '',
		lg: 'btn-lg',
	} as const;

	interface Props {
		variant?: keyof typeof VARIANT_CLASS;
		size?: keyof typeof SIZE_CLASS;
		type?: 'button' | 'submit' | 'reset';
		disabled?: boolean;
		loading?: boolean;
		fullWidth?: boolean;
		href?: string;
		class?: string;
		children: import('svelte').Snippet;
		onclick?: (e: MouseEvent) => void;
	}

	let {
		variant = 'tonal',
		size = 'md',
		type = 'button',
		disabled,
		loading,
		fullWidth,
		href,
		class: extraClass = '',
		children,
		onclick,
	}: Props = $props();

	let isDisabled = $derived(disabled || loading);
	let className = $derived(
		`${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]}${fullWidth ? ' w-full' : ''}${extraClass ? ' ' + extraClass : ''}`
	);
</script>

{#if href}
	<a {href} class={className}>
		{@render children()}
	</a>
{:else}
	<button {type} class={className} disabled={isDisabled} {onclick}>
		{#if loading}...{:else}{@render children()}{/if}
	</button>
{/if}
