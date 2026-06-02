<script lang="ts">
	const SIZE_CLASS = {
		sm: 'text-sm',
		md: '',
		lg: 'text-lg',
	} as const;

	interface Props {
		label?: string;
		hint?: string;
		accept?: string;
		size?: keyof typeof SIZE_CLASS;
		disabled?: boolean;
		onFileChange?: (file: File | null) => void;
		class?: string;
	}

	let { label, hint, accept, size = 'md', disabled, onFileChange, class: extraClass = '' }: Props = $props();

	let labelClass = $derived(`block${extraClass ? ' ' + extraClass : ''}`);
</script>

<label class={labelClass}>
	{#if label}
		<span class="text-sm font-medium text-surface-700-300">{label}</span>
	{/if}
	{#if hint}
		<span class="text-xs text-surface-500 ml-2">{hint}</span>
	{/if}
	<input
		class="input mt-1 {SIZE_CLASS[size]}"
		type="file"
		{accept}
		{disabled}
		onchange={(e) => {
			const target = e.currentTarget as HTMLInputElement;
			onFileChange?.(target.files?.[0] ?? null);
		}}
	/>
</label>
