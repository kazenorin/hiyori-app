<script lang="ts">
	interface Props {
		value: string;
		size: 'sm' | 'xs';
		onSubmit: () => void;
		onCancel: () => void;
	}

	let { value = $bindable(), size, onSubmit, onCancel }: Props = $props();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			onSubmit();
		} else if (e.key === 'Escape') {
			onCancel();
		}
	}
</script>

<input
	autofocus
	maxlength="200"
	class="input {size === 'sm' ? 'text-sm' : 'text-xs'} flex-1"
	bind:value
	onkeydown={handleKeydown}
	onblur={onSubmit}
	onclick={(e) => e.stopPropagation()}
	type="text"
/>
