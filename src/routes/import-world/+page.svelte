<script lang="ts">
	import { goto } from '$app/navigation';
	import { getImportWorldStore } from './import-state.svelte';
	import { prepareImport, confirmImport, cancelImport } from '$lib/features/import-world/import-orchestrator';
	import { enterActPlotInterviewMode } from '$lib/features/world-builder/world-builder.svelte';
	import { selectStory, selectAct, selectActLine } from '$lib/stores/stories.svelte';
	import { t } from '$lib/i18n';
	import ImportPreviewTable from './ImportPreviewTable.svelte';

	const store = getImportWorldStore();

	async function handleImport() {
		window.scrollTo(0, 0);

		const result = store.validate();
		if (!result.isValid) return;

		store.setImporting(true);
		store.importPhase = 'parsing';

		const preview = await prepareImport(store.getFormData(), (update) => {
			store.addProgressUpdate(update);
		});

		if (preview) {
			store.setPreviewData(preview);
			store.importPhase = 'preview';
			store.setImporting(false);
		} else {
			store.setImporting(false);
			store.importPhase = 'form';
		}
	}

	async function handleConfirmImport() {
		if (!store.previewData) return;

		store.setImporting(true);
		store.importPhase = 'saving';

		const importResult = await confirmImport(store.previewData, (update) => {
			store.addProgressUpdate(update);
		});

		if (importResult.success && importResult.importComplete) {
			store.setImportComplete();

			if (importResult.needsInterview && importResult.actLineId && importResult.worldContent) {
				await selectStory(importResult.storyId!);
				await selectAct(importResult.lastActId!);
				await selectActLine(importResult.actLineId);
				await enterActPlotInterviewMode({
					actLineId: importResult.actLineId,
					worldContent: importResult.worldContent,
					additionalContext: importResult.interviewContext
						? {
								actCard: importResult.interviewContext.actCard?.content ?? undefined,
								characterCards: importResult.interviewContext.characterCards,
							}
						: undefined,
				});
				goto('/');
			}
		} else {
			store.setImporting(false);
			store.importPhase = 'form';
		}
	}

	async function handleCancelImport() {
		if (store.previewData) {
			await cancelImport(store.previewData);
			store.clearPreviewData();
		}
	}

	function handleBack() {
		goto('/');
	}
</script>

<div class="flex-1 overflow-y-auto p-6">
	<div class="max-w-3xl mx-auto space-y-6">
		<div class="flex items-center justify-between">
			<h1 class="h2 font-display">{t('importWorld.heading')}</h1>
			<button class="btn preset-tonal" type="button" onclick={handleBack} disabled={store.isImporting}>
				{t('importWorld.backToChat')}
			</button>
		</div>

		<!-- Import Progress (shown at top for visibility) -->
		{#if store.isImporting || store.importComplete || store.progressUpdates.length > 0}
			<section class="card p-6 space-y-4">
				<h2 class="h4">
					{#if store.importComplete}
						{t('importWorld.importComplete')}
					{:else}
						{t('importWorld.importProgress')}
					{/if}
				</h2>

				{#if store.isImporting}
					<div class="flex items-center gap-2">
						<div class="animate-spin h-4 w-4 border-2 border-primary-500 border-t-transparent rounded-full"></div>
						<span class="text-sm text-surface-700-300">
							{store.progressUpdates[store.progressUpdates.length - 1]?.message ?? t('importWorld.processing')}
						</span>
					</div>
				{/if}

				{#if store.importComplete}
					<div class="flex items-center gap-2 text-success-600">
						<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
						</svg>
						<span class="text-sm font-medium">{t('importWorld.storyImportedSuccessfully')}</span>
					</div>
				{/if}

				{#if store.consoleOutput}
					<div class="bg-surface-900-100 text-surface-100-900 rounded-lg p-4 font-mono text-xs max-h-96 overflow-y-auto">
						<pre class="whitespace-pre-wrap break-words">{store.consoleOutput}</pre>
					</div>
				{/if}

				{#if store.importError}
					<div class="card p-4 border border-error-500">
						<h3 class="text-sm font-semibold text-error-600">{t('importWorld.importFailed')}</h3>
						<p class="text-sm text-error-500 mt-1">{store.importError}</p>
					</div>
				{/if}

				<details>
					<summary class="text-sm font-medium cursor-pointer text-surface-500">{t('importWorld.fullLog')}</summary>
					<div class="mt-2 space-y-1 max-h-64 overflow-y-auto">
						{#each store.progressUpdates as update, i (i)}
							<p class="text-xs text-surface-500">
								<span class="font-mono">[{update.phase}]</span>
								{update.message}
								{#if !!update.repeatedMessageCounter}
									<span class="font-mono">x{update.repeatedMessageCounter}</span>
								{/if}
							</p>
						{/each}
					</div>
				</details>
			</section>
		{/if}

		<!-- Preview: Review imported messages -->
		{#if store.importPhase === 'preview' && store.previewData}
			<section class="card p-6 space-y-4">
				<h2 class="h4">{t('importWorld.reviewMessages')}</h2>
				<p class="text-sm text-surface-500">{t('importWorld.reviewDescription')}</p>
				<ImportPreviewTable acts={store.previewData.acts} onToggleRemoved={store.toggleMessageRemoved} />
			</section>
		{/if}

		<!-- Form Sections - Hidden During Import and Preview -->
		{#if store.importPhase === 'form'}
			{#if store.validationResult && store.validationResult.errors.length > 0}
				<div class="card p-4 border border-error-500 bg-error-50 dark:bg-error-950 space-y-2">
					<h3 class="text-sm font-semibold text-error-700 dark:text-error-400">{t('importWorld.validationErrors')}</h3>
					{#each store.validationResult.errors as error, i (i)}
						<p class="text-sm text-error-600 dark:text-error-400">{error.message}</p>
					{/each}
				</div>
			{/if}

			{#if store.showValidationWarnings && store.validationResult?.warnings}
				<details class="card p-4 border border-warning-500 bg-warning-50 dark:bg-warning-950">
					<summary class="text-sm font-semibold text-warning-700 dark:text-warning-400 cursor-pointer">
						{t('importWorld.warnings', { count: store.validationResult.warnings.length })}
					</summary>
					<div class="mt-2 space-y-1">
						{#each store.validationResult.warnings as warning, i (i)}
							<p class="text-sm text-warning-600 dark:text-warning-400">{warning.message}</p>
						{/each}
					</div>
				</details>
			{/if}

			<!-- Story Name -->
			<section class="card p-6 space-y-4">
				<h2 class="h4">{t('importWorld.storyDetails')}</h2>

				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">{t('importWorld.storyName')}</span>
					<span class="text-xs text-surface-500 ml-2">{t('importWorld.optional')}</span>
					<input
						class="input mt-1"
						type="text"
						placeholder={t('importWorld.autoGeneratedPlaceholder')}
						bind:value={store.storyName}
						disabled={store.isImporting || store.importComplete}
					/>
				</label>

				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">{t('importWorld.worldBuildingFile')}</span>
					<span class="text-xs text-surface-500 ml-2">{t('importWorld.mdOrTxtHint')}</span>
					<input
						class="input mt-1"
						type="file"
						accept=".md,.txt"
						disabled={store.isImporting || store.importComplete}
						onchange={(e) => {
							const target = e.target as HTMLInputElement;
							store.worldFile = target.files?.[0] ?? null;
						}}
					/>
				</label>
			</section>

			<!-- Acts -->
			<section class="card p-6 space-y-4">
				<div class="flex items-center justify-between">
					<h2 class="h4">{t('importWorld.actsChapters')}</h2>
					<button
						class="btn preset-tonal text-sm"
						type="button"
						onclick={store.addAct}
						disabled={store.isImporting || store.importComplete}
					>
						{t('importWorld.addAct')}
					</button>
				</div>

				{#if store.acts.length === 0}
					<p class="text-sm text-surface-500">{t('importWorld.noActsAdded')}</p>
				{/if}

				{#each store.acts as act, index (act.id)}
					<div class="card p-4 space-y-3 border border-surface-200-800">
						<div class="flex items-center justify-between">
							<h3 class="text-sm font-semibold">{t('importWorld.act', { n: index + 1 })}</h3>
							<button
								class="btn variant-ghost text-sm text-error-600"
								type="button"
								onclick={() => store.removeAct(act.id)}
								disabled={store.isImporting || store.importComplete}
							>
								{t('importWorld.remove')}
							</button>
						</div>

						<label class="block">
							<span class="text-sm font-medium text-surface-700-300">{t('importWorld.actName')}</span>
							<span class="text-xs text-surface-500 ml-2">{t('importWorld.optional')}</span>
							<input
								class="input mt-1"
								type="text"
								placeholder={t('importWorld.autoGeneratedPlaceholder')}
								value={act.name}
								oninput={(e) => store.updateActName(act.id, (e.target as HTMLInputElement).value)}
								disabled={store.isImporting || store.importComplete}
							/>
						</label>

						<label class="block">
							<span class="text-sm font-medium text-surface-700-300">{t('importWorld.actChapterFile')}</span>
							<span class="text-xs text-surface-500 ml-2">{t('importWorld.mdOrTxtHint')}</span>
							<input
								class="input mt-1"
								type="file"
								accept=".md,.txt"
								disabled={store.isImporting || store.importComplete}
								onchange={(e) => {
									const target = e.target as HTMLInputElement;
									store.updateActFile(act.id, target.files?.[0] ?? null);
								}}
							/>
						</label>

						<label class="block">
							<span class="text-sm font-medium text-surface-700-300">{t('importWorld.transcript')}</span>
							<span class="text-xs text-surface-500 ml-2">{t('importWorld.jsonHint')}</span>
							<input
								class="input mt-1"
								type="file"
								accept=".json"
								disabled={store.isImporting || store.importComplete}
								onchange={(e) => {
									const target = e.target as HTMLInputElement;
									store.updateActTranscript(act.id, target.files?.[0] ?? null);
								}}
							/>
						</label>
					</div>
				{/each}
			</section>

			<!-- Characters -->
			<section class="card p-6 space-y-4">
				<div class="flex items-center justify-between">
					<h2 class="h4">{t('importWorld.characters')}</h2>
					<button
						class="btn preset-tonal text-sm"
						type="button"
						onclick={store.addCharacter}
						disabled={store.isImporting || store.importComplete}
					>
						{t('importWorld.addCharacter')}
					</button>
				</div>

				{#if store.characters.length === 0}
					<p class="text-sm text-surface-500">{t('importWorld.noCharactersAdded')}</p>
				{/if}

				{#each store.characters as character (character.id)}
					<div class="card p-4 space-y-3 border border-surface-200-800">
						<div class="flex items-center justify-between">
							<h3 class="text-sm font-semibold">{t('importWorld.character')}</h3>
							<button
								class="btn variant-ghost text-sm text-error-600"
								type="button"
								onclick={() => store.removeCharacter(character.id)}
								disabled={store.isImporting || store.importComplete}
							>
								{t('importWorld.remove')}
							</button>
						</div>

						<label class="block">
							<span class="text-sm font-medium text-surface-700-300">{t('importWorld.characterName')}</span>
							<span class="text-xs text-surface-500 ml-2">{t('importWorld.optional')}</span>
							<input
								class="input mt-1"
								type="text"
								placeholder={t('importWorld.derivedFromCardPlaceholder')}
								value={character.name}
								oninput={(e) => store.updateCharacterName(character.id, (e.target as HTMLInputElement).value)}
								disabled={store.isImporting || store.importComplete}
							/>
						</label>

						<label class="block">
							<span class="text-sm font-medium text-surface-700-300">{t('importWorld.characterCard')}</span>
							<span class="text-xs text-surface-500 ml-2">{t('importWorld.mdOrTxtRequiredHint')}</span>
							<input
								class="input mt-1"
								type="file"
								accept=".md,.txt"
								disabled={store.isImporting || store.importComplete}
								onchange={(e) => {
									const target = e.target as HTMLInputElement;
									store.updateCharacterFile(character.id, target.files?.[0] ?? null);
								}}
							/>
						</label>
					</div>
				{/each}
			</section>

			<!-- Import Settings -->
			<section class="card p-6 space-y-4">
				<h2 class="h4">{t('importWorld.importSettings')}</h2>

				<label class="flex items-center gap-2">
					<input
						type="checkbox"
						class="checkbox"
						bind:checked={store.skipOptionalMalformed}
						disabled={store.isImporting || store.importComplete}
					/>
					<span class="text-sm text-surface-700-300">{t('importWorld.skipMalformed')}</span>
				</label>

				<div class="grid grid-cols-2 gap-4">
					<label class="block">
						<span class="text-sm font-medium text-surface-700-300">{t('importWorld.llmRetryCount')}</span>
						<input
							class="input mt-1"
							type="number"
							min="0"
							max="20"
							bind:value={store.retryCount}
							disabled={store.isImporting || store.importComplete}
						/>
					</label>

					<label class="block">
						<span class="text-sm font-medium text-surface-700-300">{t('importWorld.backoffInterval')}</span>
						<input
							class="input mt-1"
							type="number"
							min="1"
							max="60"
							bind:value={store.backoffIntervalSeconds}
							disabled={store.isImporting || store.importComplete}
						/>
					</label>
				</div>
			</section>
		{/if}

		<!-- Submit -->
		<div class="flex justify-end gap-3 pb-8">
			{#if store.importComplete}
				<button class="btn variant-filled" type="button" onclick={handleBack}> {t('importWorld.backToChat')} </button>
			{:else if store.importPhase === 'preview'}
				<button class="btn variant-ghost" type="button" onclick={handleCancelImport}>
					{t('importWorld.cancelImport')}
				</button>
				<button class="btn variant-filled" type="button" onclick={handleConfirmImport}>
					{t('importWorld.confirmImport')}
				</button>
			{:else}
				<button class="btn variant-ghost" type="button" onclick={handleBack} disabled={store.isImporting}>
					{t('importWorld.cancel')}
				</button>
				<button class="btn variant-filled" type="button" onclick={handleImport} disabled={store.isImporting}>
					{store.isImporting ? t('importWorld.importing') : t('importWorld.importStory')}
				</button>
			{/if}
		</div>
	</div>
</div>
