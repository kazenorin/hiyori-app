<script lang="ts">
	import { t } from '$lib/i18n';

	interface Props {
		value: string;
		isStreaming: boolean;
		isDisabled: boolean;
		placeholder: string;
		showDirectorNotes: boolean;
		directorNotesExpanded?: boolean;
		onDirectorNotesToggle?: () => void;
		onSubmit: () => void;
		onStop?: () => void;
		onKeydown: (e: KeyboardEvent) => void;
		// Director notes content handlers
		onDirectorNotesContentUpdate?: (text: string) => void;
	}

	let {
		value = $bindable(''),
		isStreaming = false,
		isDisabled = false,
		placeholder = '',
		showDirectorNotes = false,
		directorNotesExpanded = false,
		onDirectorNotesToggle,
		onSubmit,
		onStop,
		onKeydown,
		onDirectorNotesContentUpdate,
	}: Props = $props();

	let isExpanded = $state(false);
	let textareaRef = $state<HTMLTextAreaElement | null>(null);

	function expand() {
		isExpanded = true;
		setTimeout(() => textareaRef?.focus(), 100);
	}

	function collapse() {
		isExpanded = false;
	}

	function handleSubmit() {
		if (!value.trim() || isDisabled) return;
		onSubmit();
		collapse();
	}
</script>

{#if !isExpanded}
	<div
		class="fixed left-0 right-0 z-30 bg-surface-50-950 border-t border-surface-200-800 px-3 py-2"
		style="bottom: calc(52px + env(safe-area-inset-bottom, 0px));"
	>
		<div class="flex items-center gap-3">
			<!-- Message preview / expand trigger -->
			<button
				type="button"
				onclick={expand}
				class="flex-1 flex items-center px-4 py-2.5 rounded-(--radius-base) bg-surface-100-900 border border-surface-200-800 text-sm text-surface-500 text-left min-h-[48px]"
				aria-label={placeholder}
			>
				{#if value}
					<span class="text-surface-800-200 truncate">{value}</span>
				{:else}
					<span class="truncate">{placeholder}</span>
				{/if}
			</button>

			<!-- Send FAB -->
			<button
				type="button"
				class="shrink-0 w-12 h-12 rounded-full bg-primary-500 text-white flex items-center justify-center disabled:opacity-40 shadow-lg shadow-primary-500/30 active:scale-95 transition-transform"
				disabled={!value.trim() || isDisabled}
				onclick={handleSubmit}
				aria-label={t('mobileInput.send')}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-6 w-6"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<line x1="22" y1="2" x2="11" y2="13" />
					<polygon points="22 2 15 22 11 13 2 9 22 2" />
				</svg>
			</button>
		</div>
	</div>
{/if}

{#if isExpanded}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-40 bg-black/50 transition-opacity duration-200" onclick={collapse} role="presentation">
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="absolute bottom-0 left-0 right-0 bg-surface-50-950 border-t border-surface-200-800 rounded-t-2xl p-3 max-h-[80vh] flex flex-col"
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

			<!-- Director notes toggle -->
			{#if showDirectorNotes}
				<div class="mb-2">
					<button
						type="button"
						class="flex items-center gap-1.5 text-xs text-surface-500 hover:text-surface-700-300 transition-colors"
						onclick={() => onDirectorNotesToggle?.()}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-3.5 w-3.5 {directorNotesExpanded ? 'text-primary-500' : ''}"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
							<polyline points="14 2 14 8 20 8" />
							<line x1="16" y1="13" x2="8" y2="13" />
							<line x1="16" y1="17" x2="8" y2="17" />
							<polyline points="10 9 9 9 8 9" />
						</svg>
						<span>{t('mobileInput.directorNotes')}</span>
						<svg class="h-3 w-3 transition-transform {directorNotesExpanded ? 'rotate-180' : ''}" viewBox="0 0 20 20" fill="currentColor">
							<path
								fill-rule="evenodd"
								d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
								clip-rule="evenodd"
							/>
						</svg>
					</button>
				</div>
				{#if directorNotesExpanded}
					<div class="mb-2 p-2 bg-surface-100-900 rounded-(--radius-base) border border-surface-200-800">
						<p class="text-xs text-surface-500 mb-1">{t('mobileInput.directorNotesPlaceholder')}</p>
						<textarea
							class="input w-full text-sm resize-none h-20"
							placeholder={t('mobileInput.directorNotesPlaceholder')}
							oninput={(e) => onDirectorNotesContentUpdate?.(e.currentTarget.value)}
						></textarea>
					</div>
				{/if}
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
	</div>
{/if}

<style>
	textarea {
		field-sizing: content;
	}
</style>
