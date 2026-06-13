<script lang="ts">
	import { t } from '$lib/i18n';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { slide } from 'svelte/transition';

	interface RegenerateActions {
		onTryAgain: () => void;
		onDescribeChanges: (text: string) => void;
		onCancel: () => void;
	}

	interface Props {
		variant: 'desktop' | 'mobile';
		isBusy: boolean;
		actions: RegenerateActions;
	}

	let { variant, isBusy, actions }: Props = $props();
	let showTextarea = $state(false);
	let directionText = $state('');

	function handleDescribeChanges() {
		showTextarea = true;
	}

	function handleSubmit() {
		if (!directionText.trim()) return;
		actions.onDescribeChanges(directionText.trim());
	}

	function handleCancel() {
		showTextarea = false;
		directionText = '';
		actions.onCancel();
	}
</script>

{#if variant === 'desktop'}
	<div class="flex flex-col gap-2" transition:slide={{ duration: 200 }}>
		{#if showTextarea}
			<textarea
				class="w-full rounded-lg border border-surface-300-700 bg-surface-50-950 p-2 text-sm text-surface-900-100 placeholder:text-surface-400-500 focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none"
				rows={3}
				placeholder={t('chat.describeChangesPlaceholder')}
				bind:value={directionText}
			></textarea>
			<div class="flex gap-2 items-center">
				<button
					class="btn preset-filled-primary-500 text-xs gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
					disabled={!directionText.trim() || isBusy}
					onclick={handleSubmit}
				>
					<Icon name="regenerate" class="w-3.5 h-3.5" />
					{t('chat.regenerate')}
				</button>
				<button class="btn preset-tonal text-xs" onclick={handleCancel}>
					{t('chat.cancel')}
				</button>
			</div>
		{:else}
			<div class="flex gap-2 items-center">
				<button class="btn preset-filled-primary-500 text-xs gap-1" disabled={isBusy} onclick={actions.onTryAgain}>
					<Icon name="regenerate" class="w-3.5 h-3.5" />
					{t('chat.tryAgain')}
				</button>
				<button class="btn preset-filled-success-500 text-xs gap-1" onclick={handleDescribeChanges}>
					<Icon name="edit" class="w-3.5 h-3.5" />
					{t('chat.describeChanges')}
				</button>
				<button class="btn preset-tonal text-xs" onclick={actions.onCancel}>
					{t('chat.cancel')}
				</button>
			</div>
		{/if}
	</div>
{:else}
	<div class="flex flex-col gap-2 mt-2 pt-2 border-t border-surface-200-800" transition:slide={{ duration: 200 }}>
		{#if showTextarea}
			<textarea
				class="w-full rounded-lg border border-surface-300-700 bg-surface-50-950 p-2 text-sm text-surface-900-100 placeholder:text-surface-400-500 focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none"
				rows={3}
				placeholder={t('chat.describeChangesPlaceholder')}
				bind:value={directionText}
			></textarea>
			<div class="flex flex-wrap gap-2">
				<button
					class="btn preset-filled-primary-500 flex-1 min-h-11 gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
					disabled={!directionText.trim() || isBusy}
					onclick={handleSubmit}
				>
					<Icon name="regenerate" class="w-4 h-4" />
					{t('chat.regenerate')}
				</button>
				<button class="btn preset-tonal min-h-11 px-4" onclick={handleCancel}>
					{t('chat.cancel')}
				</button>
			</div>
		{:else}
			<div class="flex flex-wrap gap-2">
				<button class="btn preset-filled-primary-500 flex-1 min-h-11 gap-2" disabled={isBusy} onclick={actions.onTryAgain}>
					<Icon name="regenerate" class="w-4 h-4" />
					{t('chat.tryAgain')}
				</button>
				<button class="btn preset-filled-success-500 flex-1 min-h-11 gap-2" onclick={handleDescribeChanges}>
					<Icon name="edit" class="w-4 h-4" />
					{t('chat.describeChanges')}
				</button>
				<button class="btn preset-tonal min-h-11 px-4" onclick={actions.onCancel}>
					{t('chat.cancel')}
				</button>
			</div>
		{/if}
	</div>
{/if}
