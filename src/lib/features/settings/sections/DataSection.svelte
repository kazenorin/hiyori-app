<script lang="ts">
	import { resetConfiguration } from '$lib/stores/settings.svelte';
	import { deleteStory, getStories } from '$lib/stores/stories.svelte';
	import * as dbAppState from '$lib/db/app-state';
	import { t } from '$lib/i18n';
	import Modal from '$lib/components/ui/Modal.svelte';
	import ProgressField from '$lib/components/ui/ProgressField.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import {
		type DataImportExportState,
		createDataImportExportState,
		handleExport,
		handleImportFileSelect,
		handleImportCancel,
		handleImportConfirm,
	} from '$lib/features/data-import-export';
	import { exportGameData, importGameData, exportConfigData, importConfigData } from '$lib/db/data-portability';
	import { isTauriSync } from '$lib/runtime';
	import { ensureAllBaseConfigs } from '$lib/fs/prompt-loader';
	import { getDatabase } from '$lib/db/database';
	import { Accordion } from '@skeletonlabs/skeleton-svelte';

	let gameIO = $state<DataImportExportState>(createDataImportExportState());
	let configIO = $state<DataImportExportState>(createDataImportExportState());
	let exportProgress = $state<number | null>(null);
	let isImporting = $state(false);

	let showResetConfirm = $state(false);
	let isResetting = $state(false);

	let showDeleteAllGameDataConfirm = $state(false);
	let isDeletingAllGameData = $state(false);

	function handleExportGameData() {
		handleExport(gameIO, exportGameData, 'hiyori-game-data', (v) => (exportProgress = v));
	}
	function handleImportGameData(e: Event) {
		handleImportFileSelect(gameIO, e);
	}
	function handleImportGameDataCancel() {
		handleImportCancel(gameIO);
	}
	function handleImportGameDataConfirm() {
		handleImportConfirm(gameIO, importGameData, (v) => (isImporting = v));
	}
	function handleExportConfigData() {
		handleExport(configIO, exportConfigData, 'hiyori-config', (v) => (exportProgress = v));
	}
	function handleImportConfigData(e: Event) {
		handleImportFileSelect(configIO, e);
	}
	function handleImportConfigDataCancel() {
		handleImportCancel(configIO);
	}
	function handleImportConfigDataConfirm() {
		handleImportConfirm(configIO, importConfigData, (v) => (isImporting = v));
	}

	async function handleResetConfirm() {
		showResetConfirm = false;
		isResetting = true;
		try {
			await resetConfiguration();
			await ensureAllBaseConfigs();
			window.location.reload();
		} catch (err) {
			console.error('Reset failed:', err);
			isResetting = false;
		}
	}

	async function handleDeleteAllGameDataConfirm() {
		showDeleteAllGameDataConfirm = false;
		isDeletingAllGameData = true;
		try {
			await dbAppState.setActiveAll(null, null, null);
			const storyIds = getStories().map((s) => s.id);
			for (const id of storyIds) {
				await deleteStory(id, true);
			}
			await getDatabase().flush();
			window.location.reload();
		} catch (err) {
			console.error('Delete all game data failed:', err);
			isDeletingAllGameData = false;
		}
	}
</script>

<Card title={t('settings.data')} description={t('settings.dataDescription')}>
	{#if !isTauriSync()}
		<p class="text-xs text-warning-500">{t('settings.dataWebNotice')}</p>
	{/if}

	<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
		<!-- Game Data -->
		<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
			<div>
				<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.gameData')}</h3>
				<span class="text-xs text-surface-500">{t('settings.gameDataDescription')}</span>
			</div>
			<div class="flex items-center gap-2">
				<button
					class="btn preset-filled-tertiary-400-600 text-xs px-3 py-1 min-h-9"
					disabled={gameIO.isExporting}
					onclick={handleExportGameData}
				>
					{gameIO.isExporting ? '...' : t('settings.export')}
				</button>
				<label class="btn preset-outlined cursor-pointer text-xs px-3 py-1 min-h-9">
					{gameIO.isImporting ? '...' : t('settings.import')}
					<input type="file" accept=".zip" class="sr-only" disabled={gameIO.isImporting} onchange={handleImportGameData} />
				</label>
			</div>
			<ProgressField value={exportProgress ?? 0} label="{exportProgress}%" visible={exportProgress !== null && gameIO.isExporting} />
			{#if gameIO.importError}
				<p class="text-xs text-error-500">{gameIO.importError}</p>
			{/if}
		</div>

		<!-- Configuration -->
		<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
			<div>
				<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.configData')}</h3>
				<span class="text-xs text-surface-500">{t('settings.configDataDescription')}</span>
			</div>
			<div class="flex items-center gap-2">
				<button
					class="btn preset-filled-tertiary-400-600 text-xs px-3 py-1 min-h-9"
					disabled={configIO.isExporting}
					onclick={handleExportConfigData}
				>
					{configIO.isExporting ? '...' : t('settings.export')}
				</button>
				<label class="btn preset-outlined cursor-pointer text-xs px-3 py-1 min-h-9">
					{configIO.isImporting ? '...' : t('settings.import')}
					<input type="file" accept=".zip" class="sr-only" disabled={configIO.isImporting} onchange={handleImportConfigData} />
				</label>
			</div>
			<ProgressField value={exportProgress ?? 0} label="{exportProgress}%" visible={exportProgress !== null && configIO.isExporting} />
			{#if configIO.importError}
				<p class="text-xs text-error-500">{configIO.importError}</p>
			{/if}
		</div>
	</div>

	<!-- Danger Zone -->
	<div class="border border-error-500/30 rounded-lg overflow-hidden">
		<Accordion collapsible>
			<Accordion.Item value="danger-zone">
				<Accordion.ItemTrigger
					class="flex items-center justify-between w-full text-xs font-semibold uppercase tracking-wide text-error-500 px-4 py-3"
				>
					<span>{t('settings.dangerZone')}</span>
					<Accordion.ItemIndicator>
						<span class="transition-transform duration-150 text-error-500">&#9660;</span>
					</Accordion.ItemIndicator>
				</Accordion.ItemTrigger>
				<Accordion.ItemContent class="px-4 pb-4">
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch">
						<div class="flex flex-col gap-2">
							<div>
								<span class="text-sm font-medium text-surface-700-300">{t('settings.deleteAllGameData')}</span>
								<span class="text-xs text-surface-500 block">{t('settings.deleteAllGameDataDescription')}</span>
							</div>
							<div class="mt-auto">
								<button
									class="btn preset-filled-error-400-600 text-xs px-3 py-1 min-h-9"
									disabled={isDeletingAllGameData}
									onclick={() => (showDeleteAllGameDataConfirm = true)}
								>
									{isDeletingAllGameData ? '...' : t('settings.deleteAllGameData')}
								</button>
							</div>
						</div>
						<div class="flex flex-col gap-2">
							<div>
								<span class="text-sm font-medium text-surface-700-300">{t('settings.resetConfiguration')}</span>
								<span class="text-xs text-surface-500 block">{t('settings.resetConfigurationDescription')}</span>
							</div>
							<div class="mt-auto">
								<button
									class="btn preset-filled-error-400-600 text-xs px-3 py-1 min-h-9"
									disabled={isResetting}
									onclick={() => (showResetConfirm = true)}
								>
									{isResetting ? '...' : t('settings.resetConfiguration')}
								</button>
							</div>
						</div>
					</div>
				</Accordion.ItemContent>
			</Accordion.Item>
		</Accordion>
	</div>
</Card>

<Modal bind:open={gameIO.showImportConfirm} title={t('settings.importGameData')} variant="danger">
	{#snippet body()}
		<p class="text-sm text-surface-600-400 mb-2">{t('settings.importRecommendExport')}</p>
		<p class="text-sm text-surface-700-300">{t('settings.importGameDataWarning')}</p>
	{/snippet}
	{#snippet footer()}
		<div class="flex gap-2">
			<button
				class="flex-1 px-4 py-2 rounded-lg bg-surface-200-800 hover:bg-surface-300-700 text-surface-700-300 text-sm transition-colors min-h-11"
				type="button"
				onclick={handleImportGameDataCancel}
			>
				{t('settings.cancel')}
			</button>
			<button
				class="flex-1 px-4 py-2 rounded-lg bg-error-500 hover:bg-error-600 text-white text-sm font-medium transition-colors min-h-11"
				type="button"
				onclick={handleImportGameDataConfirm}
			>
				{t('settings.importGameData')}
			</button>
		</div>
	{/snippet}
</Modal>

<Modal bind:open={configIO.showImportConfirm} title={t('settings.importConfigData')} variant="danger">
	{#snippet body()}
		<p class="text-sm text-surface-600-400 mb-2">{t('settings.importRecommendExport')}</p>
		<p class="text-sm text-surface-700-300">{t('settings.importConfigDataWarning')}</p>
	{/snippet}
	{#snippet footer()}
		<div class="flex gap-2">
			<button
				class="flex-1 px-4 py-2 rounded-lg bg-surface-200-800 hover:bg-surface-300-700 text-surface-700-300 text-sm transition-colors min-h-11"
				type="button"
				onclick={handleImportConfigDataCancel}
			>
				{t('settings.cancel')}
			</button>
			<button
				class="flex-1 px-4 py-2 rounded-lg bg-error-500 hover:bg-error-600 text-white text-sm font-medium transition-colors min-h-11"
				type="button"
				onclick={handleImportConfigDataConfirm}
			>
				{t('settings.importConfigData')}
			</button>
		</div>
	{/snippet}
</Modal>

<Modal bind:open={showResetConfirm} title={t('settings.resetConfiguration')} variant="danger">
	{#snippet body()}
		<p class="text-sm text-surface-700-300">{t('settings.resetConfigurationWarning')}</p>
	{/snippet}
	{#snippet footer()}
		<div class="flex gap-2">
			<button
				class="flex-1 px-4 py-2 rounded-lg bg-surface-200-800 hover:bg-surface-300-700 text-surface-700-300 text-sm transition-colors min-h-11"
				type="button"
				onclick={() => (showResetConfirm = false)}
			>
				{t('settings.cancel')}
			</button>
			<button
				class="flex-1 px-4 py-2 rounded-lg bg-error-500 hover:bg-error-600 text-white text-sm font-medium transition-colors min-h-11"
				type="button"
				onclick={handleResetConfirm}
			>
				{t('settings.resetConfiguration')}
			</button>
		</div>
	{/snippet}
</Modal>

<Modal bind:open={showDeleteAllGameDataConfirm} title={t('settings.deleteAllGameData')} variant="danger">
	{#snippet body()}
		<p class="text-sm text-surface-700-300">{t('settings.deleteAllGameDataWarning')}</p>
	{/snippet}
	{#snippet footer()}
		<div class="flex gap-2">
			<button
				class="flex-1 px-4 py-2 rounded-lg bg-surface-200-800 hover:bg-surface-300-700 text-surface-700-300 text-sm transition-colors min-h-11"
				type="button"
				onclick={() => (showDeleteAllGameDataConfirm = false)}
			>
				{t('settings.cancel')}
			</button>
			<button
				class="flex-1 px-4 py-2 rounded-lg bg-error-500 hover:bg-error-600 text-white text-sm font-medium transition-colors min-h-11"
				type="button"
				onclick={handleDeleteAllGameDataConfirm}
			>
				{t('settings.deleteAllGameData')}
			</button>
		</div>
	{/snippet}
</Modal>

{#if isImporting}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="alert" aria-live="assertive">
		<div class="text-center space-y-2">
			<Spinner size="xl" />
			<div class="text-surface-100 animate-pulse">{t('settings.importing')}</div>
		</div>
	</div>
{/if}
