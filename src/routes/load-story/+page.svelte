<script lang="ts">
	import { goto } from '$app/navigation';
	import { getLoadStoryStore, type ActLineSelection } from './load-story-state.svelte';
	import { loadStoryOverwrite, loadStoryAsNew } from '$lib/features/story-export-load/story-loader';
	import { t } from '$lib/i18n';
	import { toaster } from '$lib/stores/toaster.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

	const store = getLoadStoryStore();

	let showOverwriteConfirm = $state(false);

	async function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		await store.handleFile(file);
	}

	function handleToggleLine(id: string) {
		store.toggleLine(id);
	}

	async function handleLoad() {
		if (!store.data || !store.zip) return;

		const selectedLineIds = store.actLines.filter((l) => l.included).map((l) => l.id);
		if (selectedLineIds.length === 0) return;

		if (store.loadMode === 'overwrite') {
			showOverwriteConfirm = true;
			return;
		}

		await executeLoad(selectedLineIds);
	}

	async function confirmOverwrite() {
		showOverwriteConfirm = false;
		const selectedLineIds = store.actLines.filter((l) => l.included).map((l) => l.id);
		await executeLoad(selectedLineIds);
	}

	async function executeLoad(selectedLineIds: string[]) {
		if (!store.data || !store.zip) return;

		store.isLoading = true;
		store.phase = 'loading';

		let result;
		if (store.loadMode === 'overwrite') {
			result = await loadStoryOverwrite(store.data, selectedLineIds, store.zip);
		} else {
			result = await loadStoryAsNew(store.data, selectedLineIds, store.zip);
		}

		if (result.success) {
			toaster.success({ title: t('loadStory.loadComplete') });
			goto('/');
		} else {
			store.phase = 'error';
			store.errorMessage = result.error ?? 'Unknown error';
			store.isLoading = false;
			toaster.error({ title: t('loadStory.loadFailed') });
		}
	}

	function handleBack() {
		goto('/');
	}

	function getContinuedFromName(line: ActLineSelection): string {
		if (!line.continuedFrom) return t('loadStory.none');
		const parentLine = store.actLines.find((l) => l.id === line.continuedFrom);
		return parentLine ? parentLine.name : t('loadStory.none');
	}
</script>

<div class="flex-1 overflow-y-auto p-3 md:p-4 lg:p-6">
	<div class="max-w-3xl mx-auto space-y-6">
		<div class="flex items-center justify-between">
			<h1 class="h2 font-display">{t('loadStory.heading')}</h1>
			<button class="btn preset-tonal hidden md:inline-flex" type="button" onclick={handleBack} disabled={store.isLoading}>
				{t('loadStory.backToChat')}
			</button>
		</div>

		{#if store.phase === 'select' || store.phase === 'error'}
			<Card padding="standard" gap="lg">
				<h2 class="h4">{t('loadStory.selectArchive')}</h2>
				<p class="text-sm text-surface-500">{t('loadStory.selectArchiveHint')}</p>
				<input class="input" type="file" accept=".zip" onchange={handleFileSelect} disabled={store.isLoading} />

				{#if store.errorMessage}
					<div class="card p-4 border border-error-500">
						<p class="text-sm text-error-600">{store.errorMessage}</p>
					</div>
				{/if}
			</Card>
		{/if}

		{#if store.phase === 'configuring' && store.data}
			<Card padding="standard" gap="lg">
				<h2 class="h4">{t('loadStory.storyInfo')}</h2>
				<div class="grid grid-cols-2 gap-4">
					<div>
						<span class="text-sm font-medium text-surface-700-300">{t('loadStory.storyName')}</span>
						<p class="text-sm">{store.data.story.name}</p>
					</div>
					<div>
						<span class="text-sm font-medium text-surface-700-300">{t('loadStory.locale')}</span>
						<p class="text-sm">{store.data.story.locale}</p>
					</div>
				</div>
			</Card>

			{#if store.warnings.length > 0}
				<div class="card p-4 border border-warning-500 bg-warning-50 dark:bg-warning-950">
					{#each store.warnings as warning, i (i)}
						<p class="text-sm text-warning-600 dark:text-warning-400">{warning}</p>
					{/each}
				</div>
			{/if}

			<Card padding="standard" gap="lg">
				<h2 class="h4">{t('loadStory.actLines')}</h2>
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-surface-200-800">
								<th class="text-left py-2 px-2">{t('loadStory.include')}</th>
								<th class="text-left py-2 px-2">{t('loadStory.actName')}</th>
								<th class="text-left py-2 px-2">{t('loadStory.actNumber')}</th>
								<th class="text-left py-2 px-2">{t('loadStory.continuedFrom')}</th>
								<th class="text-left py-2 px-2">{t('loadStory.plotMode')}</th>
								<th class="text-left py-2 px-2">{t('loadStory.sceneCount')}</th>
								<th class="text-left py-2 px-2">{t('loadStory.actConcluded')}</th>
							</tr>
						</thead>
						<tbody>
							{#each store.actLines as line (line.id)}
								<tr class="border-b border-surface-200-800 hover:bg-surface-100-900">
									<td class="py-2 px-2">
										{#if line.required}
											<span class="text-xs font-medium text-warning-600">{t('loadStory.required')}</span>
										{:else}
											<input type="checkbox" class="checkbox" checked={line.included} onchange={() => handleToggleLine(line.id)} />
										{/if}
									</td>
									<td class="py-2 px-2">
										<span class="font-medium">{line.name}</span>
										{#if line.isMainLine}
											<span class="text-xs text-primary-500 ml-1">(main)</span>
										{/if}
									</td>
									<td class="py-2 px-2">{line.actNumber}</td>
									<td class="py-2 px-2">{getContinuedFromName(line)}</td>
									<td class="py-2 px-2">{line.plotMode === 'guidance' ? t('loadStory.guidance') : t('loadStory.events')}</td>
									<td class="py-2 px-2">{line.sceneCount ?? '—'}</td>
									<td class="py-2 px-2">{line.actConcluded ? t('loadStory.yes') : t('loadStory.no')}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</Card>

			<Card padding="standard" gap="lg">
				<h2 class="h4">{t('loadStory.loadMode')}</h2>
				<div class="space-y-3">
					<label class="flex items-center gap-2 cursor-pointer">
						<input type="radio" name="loadMode" class="radio" bind:group={store.loadMode} value="overwrite" disabled={store.isLoading} />
						<span class="text-sm font-medium">{t('loadStory.loadOverwrite')}</span>
					</label>

					{#if store.loadMode === 'overwrite'}
						<div class="card p-4 border border-warning-500 bg-warning-50 dark:bg-warning-950">
							<p class="text-sm text-warning-600 dark:text-warning-400">{t('loadStory.overwriteWarning')}</p>
						</div>
					{/if}

					<label class="flex items-center gap-2 cursor-pointer">
						<input type="radio" name="loadMode" class="radio" bind:group={store.loadMode} value="new" disabled={store.isLoading} />
						<span class="text-sm font-medium">{t('loadStory.loadAsNew')}</span>
					</label>
				</div>
			</Card>
		{/if}

		{#if store.phase === 'loading'}
			<Card padding="standard" gap="lg">
				<div class="flex items-center gap-2">
					<Spinner size="xs" class="border-primary-500 border-t-transparent" />
					<span class="text-sm text-surface-700-300">{t('loadStory.loading')}</span>
				</div>
			</Card>
		{/if}

		{#if store.phase === 'complete'}
			<Card padding="standard" gap="lg">
				<div class="flex items-center gap-2 text-success-600">
					<Icon name="check" class="h-5 w-5" />
					<span class="text-sm font-medium">{t('loadStory.loadComplete')}</span>
				</div>
			</Card>
		{/if}

		<div class="flex justify-end gap-3 pb-8">
			{#if store.phase === 'complete'}
				<button class="btn variant-filled" type="button" onclick={handleBack}>
					{t('loadStory.backToChat')}
				</button>
			{:else if store.phase === 'configuring'}
				<button class="btn variant-ghost" type="button" onclick={handleBack} disabled={store.isLoading}>
					{t('loadStory.backToChat')}
				</button>
				<button class="btn variant-filled" type="button" onclick={handleLoad} disabled={!store.canLoad}>
					{t('loadStory.loadStoryButton')}
				</button>
			{:else}
				<button class="btn variant-ghost" type="button" onclick={handleBack} disabled={store.isLoading}>
					{t('loadStory.backToChat')}
				</button>
			{/if}
		</div>
	</div>
</div>

{#if showOverwriteConfirm}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-surface-50-950/60 backdrop-blur-sm" role="dialog" aria-modal="true">
		<Card padding="standard" gap="lg" class="max-w-md mx-4">
			<h3 class="h4">{t('loadStory.overwriteConfirmTitle')}</h3>
			<p class="text-sm text-surface-500">{t('loadStory.overwriteConfirmMessage', { name: store.data?.story.name ?? '' })}</p>
			<div class="flex justify-end gap-3 mt-4">
				<button
					class="btn variant-ghost"
					type="button"
					onclick={() => {
						showOverwriteConfirm = false;
					}}
				>
					{t('loadStory.no')}
				</button>
				<button class="btn variant-filled" type="button" onclick={confirmOverwrite}>
					{t('loadStory.yes')}
				</button>
			</div>
		</Card>
	</div>
{/if}
