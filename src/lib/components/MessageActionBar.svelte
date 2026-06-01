<script lang="ts">
	import { t } from '$lib/i18n';

	interface Props {
		showCopy?: boolean;
		showEdit?: boolean;
		showFork?: boolean;
		showRegenerate?: boolean;
		showDelete?: boolean;
		onCopy: () => void;
		onEdit?: () => void;
		onFork?: () => void;
		onRegenerate?: () => void;
		onDelete?: () => void;
	}

	let {
		showCopy = true,
		showEdit = false,
		showFork = false,
		showRegenerate = false,
		showDelete = false,
		onCopy,
		onEdit,
		onFork,
		onRegenerate,
		onDelete,
	}: Props = $props();
</script>

<div class="flex items-center gap-1 mt-2 pt-2 border-t border-surface-200-800">
	{#if showCopy}
		<button
			type="button"
			class="flex items-center justify-center w-11 h-11 rounded-lg hover:bg-surface-100-900 text-surface-500 transition-colors"
			onclick={onCopy}
			aria-label={t('chat.copy')}
			title={t('chat.copy')}
		>
			<svg
				class="h-5 w-5"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
				<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
			</svg>
		</button>
	{/if}

	{#if showEdit && onEdit}
		<button
			type="button"
			class="flex items-center justify-center w-11 h-11 rounded-lg hover:bg-surface-100-900 text-surface-500 transition-colors"
			onclick={onEdit}
			aria-label={t('chat.edit')}
			title={t('chat.edit')}
		>
			<svg
				class="h-5 w-5"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
				<path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
			</svg>
		</button>
	{/if}

	{#if showFork && onFork}
		<button
			type="button"
			class="flex items-center justify-center w-11 h-11 rounded-lg hover:bg-surface-100-900 text-surface-500 transition-colors"
			onclick={onFork}
			aria-label={t('chat.fork')}
			title={t('chat.fork')}
		>
			<svg
				class="h-5 w-5"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<line x1="6" y1="3" x2="6" y2="15" />
				<circle cx="18" cy="6" r="3" />
				<circle cx="6" cy="18" r="3" />
				<path d="M18 9a9 9 0 01-9 9" />
			</svg>
		</button>
	{/if}

	{#if showRegenerate && onRegenerate}
		<button
			type="button"
			class="flex items-center justify-center w-11 h-11 rounded-lg hover:bg-surface-100-900 text-surface-500 transition-colors"
			onclick={onRegenerate}
			aria-label={t('chat.regenerate')}
			title={t('chat.regenerate')}
		>
			<svg
				class="h-5 w-5"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<polyline points="23 4 23 10 17 10" />
				<polyline points="1 20 1 14 7 14" />
				<path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
			</svg>
		</button>
	{/if}

	{#if showDelete && onDelete}
		<button
			type="button"
			class="flex items-center justify-center w-11 h-11 rounded-lg hover:bg-surface-100-900 text-error-500 transition-colors"
			onclick={onDelete}
			aria-label={t('chat.delete')}
			title={t('chat.delete')}
		>
			<svg
				class="h-5 w-5"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<polyline points="3 6 5 6 21 6" />
				<path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
			</svg>
		</button>
	{/if}
</div>
