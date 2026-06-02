<script lang="ts">
	import { t } from '$lib/i18n';
	import Icon from '$lib/components/ui/Icon.svelte';

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
			<Icon name="copy" class="h-5 w-5" />
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
			<Icon name="edit" class="h-5 w-5" />
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
			<Icon name="fork" class="h-5 w-5" />
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
			<Icon name="regenerate" class="h-5 w-5" />
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
			<Icon name="trash" class="h-5 w-5" />
		</button>
	{/if}
</div>
