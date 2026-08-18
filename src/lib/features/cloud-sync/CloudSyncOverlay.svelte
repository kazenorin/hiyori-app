<script lang="ts">
	import { t } from '$lib/i18n';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import { Progress } from '@skeletonlabs/skeleton-svelte';
	import { getCloudSyncStatus, getSyncProgress } from './cloud-sync.svelte';

	const syncing = $derived(getCloudSyncStatus() === 'syncing');
	const progress = $derived(getSyncProgress());
	const percent = $derived(progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0);
</script>

{#if syncing}
	<div
		class="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm"
		role="alert"
		aria-live="polite"
		aria-busy="true"
	>
		<div class="bg-surface-100-900 border border-surface-200-800 rounded-xl shadow-2xl p-6 w-full mx-4 max-w-sm space-y-3">
			<div class="flex items-center gap-3">
				<Spinner size="md" />
				<span class="text-lg font-semibold text-surface-900-100">{t('cloudSync.syncing')}</span>
			</div>
			{#if progress?.current}
				<p class="text-sm text-surface-500 truncate">{progress.current}</p>
			{/if}
			{#if progress && progress.total > 0}
				<Progress value={percent}>
					<Progress.Track>
						<Progress.Range />
					</Progress.Track>
				</Progress>
				<p class="text-xs text-surface-500 text-right">{progress.done} / {progress.total}</p>
			{/if}
		</div>
	</div>
{/if}
