<script lang="ts">
	import { tick } from 'svelte';

	const WIDTH_CLASS = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl' } as const;

	interface Props {
		open: boolean;
		title: string;
		variant?: 'default' | 'danger';
		onclose?: () => void;
		width?: keyof typeof WIDTH_CLASS;
		body: import('svelte').Snippet;
		footer?: import('svelte').Snippet;
	}

	let { open = $bindable(), title, variant = 'default', onclose, width = 'sm', body, footer }: Props = $props();

	let panelRef: HTMLDivElement | null = $state(null);
	const titleId = `modal-title-${Math.random().toString(36).slice(2, 9)}`;

	$effect(() => {
		if (open) {
			tick().then(() => {
				const firstFocusable = panelRef?.querySelector<HTMLElement>(
					'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
				);
				firstFocusable?.focus();
			});
		}
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onclose?.();
		} else if (e.key === 'Tab' && panelRef) {
			const focusable = panelRef.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
			);
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		role="dialog"
		aria-modal="true"
		aria-labelledby={titleId}
		tabindex="-1"
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		onclick={() => onclose?.()}
		onkeydown={handleKeydown}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			bind:this={panelRef}
			class="bg-surface-100-900 border border-surface-200-800 rounded-xl shadow-2xl p-6 w-full mx-4 {WIDTH_CLASS[width]}"
			onclick={(e) => e.stopPropagation()}
			onkeydown={() => {}}
		>
			<h3 id={titleId} class="text-lg font-semibold {variant === 'danger' ? 'text-error-500' : 'text-surface-900-100'} mb-3">
				{title}
			</h3>
			<div>
				{@render body()}
			</div>
			{#if footer}
				<div class="mt-5">
					{@render footer()}
				</div>
			{/if}
		</div>
	</div>
{/if}
