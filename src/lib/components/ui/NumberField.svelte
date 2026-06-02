<script lang="ts">
	const SIZE_CLASS = {
		sm: 'text-sm',
		md: '',
		lg: 'text-lg',
	} as const;

	interface Props {
		label?: string;
		hint?: string;
		value: number | null;
		min?: number;
		max?: number;
		step?: number;
		size?: keyof typeof SIZE_CLASS;
		placeholder?: string;
		disabled?: boolean;
		onValueChange?: (v: number) => void;
		class?: string;
	}

	let {
		label,
		hint,
		value = $bindable(),
		min,
		max,
		step,
		size = 'md',
		placeholder,
		disabled,
		onValueChange,
		class: extraClass = '',
	}: Props = $props();

	let labelClass = $derived(`block${extraClass ? ' ' + extraClass : ''}`);
</script>

<label class={labelClass}>
	{#if label}
		<span class="text-sm font-medium text-surface-700-300">{label}</span>
	{/if}
	<input
		class="input mt-1 {SIZE_CLASS[size]}"
		type="number"
		value={value ?? ''}
		{min}
		{max}
		{step}
		{placeholder}
		{disabled}
		onchange={(e) => {
			const raw = (e.currentTarget as HTMLInputElement).value;
			if (raw === '') return;
			const v = parseInt(raw, 10);
			if (!isNaN(v)) onValueChange?.(v);
		}}
	/>
	{#if hint}
		<span class="text-xs text-surface-500 mt-1 block">{hint}</span>
	{/if}
</label>
