<script lang="ts">
	const SIZE_CLASS = {
		sm: 'text-sm',
		md: '',
		lg: 'text-lg',
	} as const;

	interface Props {
		label?: string;
		hint?: string;
		value: string;
		type?: 'text' | 'url' | 'password' | 'email' | 'number';
		size?: keyof typeof SIZE_CLASS;
		placeholder?: string;
		disabled?: boolean;
		class?: string;
	}

	let { label, hint, value = $bindable(), type = 'text', size = 'md', placeholder, disabled, class: extraClass = '' }: Props = $props();

	let labelClass = $derived(`block${extraClass ? ' ' + extraClass : ''}`);
</script>

<label class={labelClass}>
	{#if label}
		<span class="text-sm font-medium text-surface-700-300">{label}</span>
	{/if}
	<input class="input mt-1 {SIZE_CLASS[size]}" {type} {placeholder} bind:value {disabled} />
	{#if hint}
		<span class="text-xs text-surface-500 mt-1 block">{hint}</span>
	{/if}
</label>
