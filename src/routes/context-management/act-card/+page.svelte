<script lang="ts">
	import { t } from '$lib/i18n';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { getActiveStory, getActiveActLineId } from '$lib/stores/stories.svelte';
	import { regenerateActCard, checkActCardExists } from '$lib/features/act-card-generator';
	import { getActLine, getMessagesForLine, isActLineEnded } from '$lib/db/act-lines';
	import { getActByActLineId, traceActLineChain } from '$lib/db/acts';
	import type { ActLineMeta } from '$lib/db/act-lines';
	import { log } from '$lib/logging/logger';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import { SvelteSet } from 'svelte/reactivity';

	interface ActCardTableRow {
		actLineId: string;
		actNumber: number;
		actName: string;
		isConcluded: boolean;
		hasActCard: boolean;
		hasNarrative: boolean;
		actLine: ActLineMeta | null;
	}

	const activeStory = $derived(getActiveStory());
	const activeActLineId = $derived(getActiveActLineId());

	let tableRows = $state<ActCardTableRow[]>([]);
	let selectedActLineIds = new SvelteSet<string>();
	let isGenerating = $state(false);
	let generationStatus = $state<string | null>(null);
	let results = $state<{ actNumber: number; content: string; generated: boolean; filePath: string }[]>([]);

	$effect(() => {
		const story = activeStory;
		const id = activeActLineId;
		if (!story || !id) {
			tableRows = [];
			selectedActLineIds.clear();
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				const chain = await traceActLineChain(id);
				const rows: ActCardTableRow[] = [];
				for (const entry of chain) {
					const act = await getActByActLineId(entry.actLineId);
					const actLine = await getActLine(entry.actLineId);
					const messages = await getMessagesForLine(entry.actLineId);
					if (messages.length === 0) continue;
					const isConcluded = await isActLineEnded(entry.actLineId);
					let hasActCard = false;
					if (actLine && act) {
						hasActCard = await checkActCardExists({
							storyId: story.id,
							storyName: story.name,
							actLineId: entry.actLineId,
							actLine,
							actNumber: entry.actNumber,
						});
					}
					rows.push({
						actLineId: entry.actLineId,
						actNumber: entry.actNumber,
						actName: act?.name ?? `Act ${entry.actNumber}`,
						isConcluded,
						hasActCard,
						hasNarrative: true,
						actLine,
					});
				}
				rows.sort((a, b) => a.actNumber - b.actNumber);
				if (!cancelled) {
					tableRows = rows;
					selectedActLineIds.clear();
				}
			} catch (err) {
				await log.error('context-management', 'Failed to load act card lineage table', err);
				if (!cancelled) {
					tableRows = [];
					selectedActLineIds.clear();
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	const hasUnconcludedSelected = $derived(tableRows.some((r) => selectedActLineIds.has(r.actLineId) && !r.isConcluded));
	const canGenerate = $derived(selectedActLineIds.size > 0 && !isGenerating);

	function toggleRow(actLineId: string) {
		if (selectedActLineIds.has(actLineId)) {
			selectedActLineIds.delete(actLineId);
		} else {
			selectedActLineIds.add(actLineId);
		}
	}

	async function handleGenerate() {
		const story = activeStory;
		if (!story) return;
		const selectedRows = tableRows.filter((r) => selectedActLineIds.has(r.actLineId)).sort((a, b) => a.actNumber - b.actNumber);
		if (selectedRows.length === 0) return;

		isGenerating = true;
		generationStatus = null;
		results = [];

		for (const row of selectedRows) {
			try {
				generationStatus = row.hasActCard
					? `Regenerating act card for Act ${row.actNumber}...`
					: `Generating act card for Act ${row.actNumber}...`;
				const actLine = row.actLine ?? (await getActLine(row.actLineId));
				if (!actLine) {
					throw new Error(`Act line not found for Act ${row.actNumber}`);
				}
				const result = await regenerateActCard({
					storyId: story.id,
					storyName: story.name,
					actLineId: row.actLineId,
					actLine,
					actNumber: row.actNumber,
				});
				results.push({
					actNumber: row.actNumber,
					content: result.content,
					generated: result.generated,
					filePath: result.filePath,
				});
				row.hasActCard = true;
			} catch (err) {
				await log.error('context-management', `Act card generation failed for Act ${row.actNumber}`, err);
				results.push({
					actNumber: row.actNumber,
					content: '',
					generated: false,
					filePath: '',
				});
			}
		}

		generationStatus = null;
		isGenerating = false;
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
		<!-- Header -->
		<div class="flex items-center gap-4">
			<button class="btn btn-sm preset-tonal min-h-11 hidden md:inline-flex" onclick={handleBack}>
				&larr; {t('characterCards.back')}
			</button>
			<h2 class="h2">{t('contextManagement.actCard.title')}</h2>
		</div>

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
			<!-- Lineage Table -->
			<section class="card p-3 md:p-4 space-y-3">
				{#if tableRows.length === 0}
					<p class="text-sm text-surface-500">No acts with narrative content found in the lineage.</p>
				{:else}
					<!-- Desktop table layout -->
					<div class="hidden md:block overflow-x-auto">
						<div class="min-w-[560px]">
							<div
								class="grid grid-cols-[40px_minmax(60px,auto)_minmax(160px,1fr)_120px_120px] gap-3 text-xs font-semibold text-surface-700-300 uppercase tracking-wide border-b border-surface-200-800 pb-2"
							>
								<span></span>
								<span>{t('characterCards.act')}</span>
								<span>{t('characterCards.actLine')}</span>
								<span class="text-center">Concluded</span>
								<span class="text-center">Act Card</span>
							</div>

							{#each tableRows as row (row.actLineId)}
								<div
									class="grid grid-cols-[40px_minmax(60px,auto)_minmax(160px,1fr)_120px_120px] gap-3 items-center py-2 border-b border-surface-100-900"
								>
									<span class="flex justify-center">
										<input
											type="checkbox"
											class="checkbox"
											checked={selectedActLineIds.has(row.actLineId)}
											onchange={() => toggleRow(row.actLineId)}
										/>
									</span>
									<span class="text-surface-950-50">{row.actNumber}</span>
									<span class="text-surface-950-50">{row.actName}</span>
									<span class="flex justify-center">
										{#if row.isConcluded}
											<Icon name="check-circle" class="size-5 text-success-500" />
										{:else}
											<Icon name="circle-check" class="size-5 text-surface-400" />
										{/if}
									</span>
									<span class="flex justify-center">
										{#if row.hasActCard}
											<Icon name="check-circle" class="size-5 text-success-500" />
										{:else}
											<Icon name="x-circle" class="size-5 text-error-500" />
										{/if}
									</span>
								</div>
							{/each}
						</div>
					</div>

					<!-- Mobile card layout -->
					<div class="md:hidden space-y-3">
						{#each tableRows as row (row.actLineId)}
							<div class="space-y-2 p-3 border border-surface-200-800 rounded-container">
								<div class="flex items-center justify-between">
									<div class="flex items-center gap-2">
										<input
											type="checkbox"
											class="checkbox"
											checked={selectedActLineIds.has(row.actLineId)}
											onchange={() => toggleRow(row.actLineId)}
										/>
										<span class="text-sm font-semibold text-surface-950-50">Act {row.actNumber}</span>
									</div>
									<div class="flex items-center gap-2">
										{#if row.isConcluded}
											<Icon name="check-circle" class="size-5 text-success-500" />
										{:else}
											<Icon name="circle-check" class="size-5 text-surface-400" />
										{/if}
										{#if row.hasActCard}
											<Icon name="check-circle" class="size-5 text-success-500" />
										{:else}
											<Icon name="x-circle" class="size-5 text-error-500" />
										{/if}
									</div>
								</div>
								<p class="text-sm text-surface-700-300">{row.actName}</p>
							</div>
						{/each}
					</div>
				{/if}
			</section>

			<!-- Not concluded warning -->
			{#if hasUnconcludedSelected}
				<div class="card p-4 border border-secondary-500-300">
					<div class="flex items-start gap-2">
						<Icon name="triangle-alert" class="size-5 shrink-0 text-secondary-500 mt-0.5" />
						<p class="text-sm text-surface-700-300">{t('contextManagement.actCard.notConcludedWarning')}</p>
					</div>
				</div>
			{/if}

			<!-- Generation status -->
			{#if isGenerating && generationStatus}
				<div class="card p-4 flex items-center gap-3">
					<Spinner size="xs" />
					<p class="text-sm text-surface-500">{generationStatus}</p>
				</div>
			{/if}

			<!-- Generate button -->
			<div class="flex items-center gap-4">
				<button class="btn preset-filled-primary-500 min-h-11 md:min-h-0" onclick={handleGenerate} disabled={!canGenerate}>
					{t('memoryManager.generateActCard')}
				</button>
			</div>

			<!-- Results -->
			{#if results.length > 0 && !isGenerating}
				<section class="card p-4 space-y-2 border border-success-500-300">
					<h3 class="font-semibold text-success-700-300">
						{t('memoryManager.actCardGenerated')}
					</h3>
					<ul class="list-disc list-inside text-sm text-surface-700-300 space-y-1">
						{#each results as r (r.actNumber)}
							<li>
								<strong class="text-surface-950-50">Act {r.actNumber}</strong>:
								{#if r.filePath}
									{r.generated
										? t('memoryManager.actCardGenerated')
										: t('memoryManager.actCardSaved', { file: r.filePath.split('/').pop() ?? 'unknown' })}
								{:else}
									<span class="text-error-700-300">{t('memoryManager.generationFailed')}</span>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/if}
	</div>
</div>
