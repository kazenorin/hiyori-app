<script lang="ts">
	import { t } from '$lib/i18n';
	import { mobileNav } from '$lib/stores/mobile-nav.svelte';
	import DirectorNotesPanel from './DirectorNotesPanel.svelte';

	interface Props {
		value: string;
		isStreaming: boolean;
		isDisabled: boolean;
		placeholder: string;
		showDirectorNotes: boolean;
		onSubmit: () => void;
		onStop?: () => void;
		onKeydown: (e: KeyboardEvent) => void;
	}

	let {
		value = $bindable(''),
		isStreaming = false,
		isDisabled = false,
		placeholder = '',
		showDirectorNotes = false,
		onSubmit,
		onStop,
		onKeydown,
	}: Props = $props();

	let isExpanded = $derived(mobileNav.inputSheetOpen);
	let textareaRef = $state<HTMLTextAreaElement | null>(null);

	$effect(() => {
		if (isExpanded && textareaRef) {
			setTimeout(() => textareaRef?.focus(), 100);
		}
	});

	function collapse() {
		mobileNav.inputSheetOpen = false;
	}

	function handleSubmit() {
		if (!value.trim() || isDisabled) return;
		onSubmit();
		collapse();
	}
</script>

{#if isExpanded}
	<!-- Expanded sheet: backdrop covers viewport above tab bar; content sits at bottom above tab bar -->
	<div
		class="fixed inset-x-0 top-0 z-40 bg-black/50 transition-opacity duration-200"
		style="bottom: 52px;"
		onclick={collapse}
		role="presentation"
	></div>

	<div
		class="fixed inset-x-0 bottom-[52px] z-50 bg-surface-50-950 border-t border-surface-200-800 rounded-t-2xl p-3 max-h-[80vh] flex flex-col"
		role="dialog"
		aria-modal="true"
		aria-label={t('mobileInput.inputSheet')}
		tabindex="0"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				collapse();
			}
		}}
	>
		<!-- Drag handle -->
		<button
			type="button"
			class="w-full flex justify-center py-1 cursor-grab active:cursor-grabbing"
			aria-label={t('mobileInput.close')}
			onclick={collapse}
		>
			<div class="w-8 h-1 rounded-full bg-surface-400-600"></div>
		</button>

		<!-- Director notes -->
		{#if showDirectorNotes}
			<div class="border-b border-surface-200-800 pb-2 mb-2">
				<DirectorNotesPanel />
			</div>
		{/if}

		<!-- Textarea -->
		<textarea
			bind:this={textareaRef}
			bind:value
			class="input flex-1 w-full resize-none text-sm leading-relaxed min-h-[120px] max-h-[300px]"
			{placeholder}
			disabled={isDisabled}
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					handleSubmit();
				} else {
					onKeydown(e);
				}
			}}
			aria-label={placeholder}
		></textarea>

		<!-- Send / Stop button -->
		<div class="mt-2">
			{#if isStreaming}
				<button class="btn preset-filled-error-500 w-full h-11" type="button" onclick={onStop ?? onSubmit}>
					{t('mobileInput.stop')}
				</button>
			{:else}
				<button
					class="btn preset-filled-primary-500 w-full h-11 disabled:opacity-50"
					type="button"
					disabled={isDisabled || !value.trim()}
					onclick={handleSubmit}
				>
					{t('mobileInput.send')}
				</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	textarea {
		field-sizing: content;
	}
</style>
