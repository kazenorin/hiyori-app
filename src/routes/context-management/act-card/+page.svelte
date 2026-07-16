<script lang="ts">
	import { t } from '$lib/i18n';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { getActiveStory, getActiveAct, getActiveActLine, getActiveActLineId } from '$lib/stores/stories.svelte';
	import { ensureActCard } from '$lib/features/act-card-generator';
	import { getActLine, isActLineEnded } from '$lib/db/act-lines';
	import { log } from '$lib/logging/logger';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';

	const activeStory = $derived(getActiveStory());
	const activeAct = $derived(getActiveAct());
	const activeActLine = $derived(getActiveActLine());
	const activeActLineId = $derived(getActiveActLineId());

	let isGenerating = $state(false);
	let status = $state('');
	let generatedContent = $state<string | null>(null);
	let isActLineConcluded = $state<boolean | null>(null);

	$effect(() => {
		const id = activeActLineId;
		if (!id) {
			isActLineConcluded = null;
			return;
		}
		let cancelled = false;
		(async () => {
			const ended = await isActLineEnded(id);
			if (!cancelled) isActLineConcluded = ended;
		})();
		return () => {
			cancelled = true;
		};
	});

	async function handleGenerate() {
		if (!activeStory || !activeAct || !activeActLineId) {
			status = t('memoryManager.noActLineSelected');
			return;
		}
		isGenerating = true;
		generatedContent = null;
		status = '';

		try {
			const actLine = activeActLine ?? (await getActLine(activeActLineId));
			if (!actLine) {
				throw new Error(t('memoryManager.noActLineSelected'));
			}
			const result = await ensureActCard({
				storyId: activeStory.id,
				storyName: activeStory.name,
				actLineId: activeActLineId,
				actLine,
				actNumber: activeAct.actNumber,
			});
			generatedContent = result.content;
			status = result.generated
				? t('memoryManager.actCardGenerated')
				: t('memoryManager.actCardSaved', { file: result.filePath.split('/').pop() ?? 'unknown' });
		} catch (err) {
			const msg = err instanceof Error ? err.message : t('memoryManager.generationFailed');
			status = msg;
			await log.error('context-management', 'Act card generation failed', err);
		} finally {
			isGenerating = false;
		}
	}

	function handleBack() {
		goto(resolve('/context-management'));
	}
</script>

<svelte:head>
	<title>{t('contextManagement.actCard.title')}</title>
</svelte:head>

<div class="flex-1 overflow-y-auto p-3 md:p-4 lg:p-6">
	<div class="max-w-4xl mx-auto space-y-6">
		<div class="flex items-center gap-4">
			<button class="btn btn-sm preset-tonal min-h-11 hidden md:inline-flex" onclick={handleBack}>
				&larr; {t('characterCards.back')}
			</button>
			<h2 class="h2">{t('contextManagement.actCard.title')}</h2>
		</div>

		<section class="card p-4">
			<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
				<span class="font-semibold text-surface-700-300">{t('characterCards.story')}</span>
				<span class="text-surface-950-50">{activeStory?.name ?? '—'}</span>
				<span class="font-semibold text-surface-700-300">{t('characterCards.act')}</span>
				<span class="text-surface-950-50">{activeAct?.actNumber ?? '—'}</span>
				<span class="font-semibold text-surface-700-300">{t('characterCards.actLine')}</span>
				<span class="text-surface-950-50">{activeActLine?.name ?? '—'}</span>
			</div>
		</section>

		{#if !activeStory}
			<div class="card p-4">
				<p class="text-surface-500">{t('memoryManager.noStory')}</p>
				<a href={resolve('/load-story')} class="btn btn-sm preset-tonal min-h-11 mt-2 inline-flex">
					{t('sidebar.importWorld')}
				</a>
			</div>
		{:else if !activeActLineId}
			<div class="card p-4">
				<p class="text-surface-500">{t('memoryManager.noActLineSelected')}</p>
			</div>
		{:else}
			{#if isActLineConcluded === false}
				<div class="card p-4 border border-secondary-500-300">
					<div class="flex items-start gap-2">
						<Icon name="triangle-alert" class="size-5 shrink-0 text-secondary-500 mt-0.5" />
						<p class="text-sm text-surface-700-300">{t('contextManagement.actCard.notConcludedWarning')}</p>
					</div>
				</div>
			{/if}

			<div class="flex items-center gap-4">
				{#if isGenerating}
					<Spinner size="xs" />
					<span class="text-sm text-surface-500">{t('memoryManager.generatingActCard')}</span>
				{:else}
					<button class="btn preset-filled-primary-500 min-h-11 md:min-h-0" onclick={handleGenerate} disabled={isGenerating}>
						{t('memoryManager.generateActCard')}
					</button>
				{/if}
			</div>

			{#if status}
				<div class="card p-4">
					<p class="text-sm text-surface-500">{status}</p>
				</div>
			{/if}

			{#if generatedContent}
				<section class="card p-4 space-y-2">
					<h3 class="font-semibold text-surface-950-50">{t('memoryManager.actCardGenerated')}</h3>
					<pre class="text-xs text-surface-700-300 whitespace-pre-wrap break-words max-h-[60vh] overflow-y-auto">{generatedContent}</pre>
				</section>
			{/if}
		{/if}
	</div>
</div>
