<script lang="ts">
	import { t } from '$lib/i18n';
	import Icon from '$lib/components/ui/Icon.svelte';

	interface Props {
		showCopy?: boolean;
		showEdit?: boolean;
		showFork?: boolean;
		showRegenerate?: boolean;
		showDelete?: boolean;
		showRead?: boolean;
		isPlaying?: boolean;
		ttsEnabled?: boolean;
		onCopy: () => void;
		onEdit?: () => void;
		onFork?: () => void;
		onRegenerate?: () => void;
		onDelete?: () => void;
		onRead?: () => void;
		onStop?: () => void;
	}

	let {
		showCopy = true,
		showEdit = false,
		showFork = false,
		showRegenerate = false,
		showDelete = false,
		showRead = false,
		isPlaying = false,
		ttsEnabled = false,
		onCopy,
		onEdit,
		onFork,
		onRegenerate,
		onDelete,
		onRead,
		onStop,
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

	{#if showRead}
		{#if isPlaying && onStop}
			<button
				type="button"
				class="flex items-center justify-center w-11 h-11 rounded-lg bg-primary-500/10 text-primary-500 transition-colors"
				aria-label={t('tts.stopReading')}
				title={t('tts.stopReading')}
				onclick={onStop}
			>
				<Icon name="volume-x" class="h-5 w-5" />
			</button>
		{:else if ttsEnabled && onRead}
			<button
				type="button"
				class="flex items-center justify-center w-11 h-11 rounded-lg hover:bg-surface-100-900 text-surface-500 transition-colors"
				onclick={onRead}
				aria-label={t('tts.readAloud')}
				title={t('tts.readAloud')}
			>
				<Icon name="volume-2" class="h-5 w-5" />
			</button>
		{:else}
			<button
				type="button"
				class="flex items-center justify-center w-11 h-11 rounded-lg text-surface-300-600 cursor-not-allowed"
				aria-label={t('tts.enableTtsInSettings')}
				title={t('tts.enableTtsInSettings')}
				disabled
			>
				<Icon name="volume-2" class="h-5 w-5" />
			</button>
		{/if}
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
