<script lang="ts">
	import {
		addProviderConfig,
		assignRole,
		deleteProviderConfig,
		getMinorTaskAgentProviderConfig,
		isMemoryAvailable,
		isMemoryCapable,
		type LogLevel,
		type ProviderConfig,
		type ThemeMode,
		resetConfiguration,
		settings,
		updateProviderConfig,
		updateSettings,
	} from '$lib/stores/settings.svelte';
	import { deleteStory, getStories } from '$lib/stores/stories.svelte';
	import * as dbAppState from '$lib/db/app-state';
	import { t } from '$lib/i18n';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import ProgressField from '$lib/components/ui/ProgressField.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import ProviderForm from '$lib/components/chat/ProviderForm.svelte';
	import NumberField from '$lib/components/ui/NumberField.svelte';
	import {
		getLocaleItems,
		getLogLevelItems,
		getReviewerModeItems,
		getRoleItems,
		getVoiceItems,
		getThemeModeItems,
		getColorThemeItems,
	} from '$lib/features/settings-options';
	import { isTTSModelCached } from '$lib/kokoro/model';
	import { ttsPlayer } from '$lib/kokoro/player.svelte';
	import { TTS_SPEED_MIN, TTS_SPEED_MAX, TTS_SPEED_STEP } from '$lib/kokoro/constants';
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

	// Editing state
	let editingId = $state<string | null>(null);
	let isAddingNew = $state(false);

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

	function startEdit(config: ProviderConfig) {
		editingId = config.id;
		isAddingNew = false;
	}

	function startAdd() {
		isAddingNew = true;
		editingId = null;
	}

	function cancelEdit() {
		editingId = null;
		isAddingNew = false;
	}

	function handleSaveFromForm(id: string, data: Omit<ProviderConfig, 'id'>) {
		updateProviderConfig(id, data);
		cancelEdit();
	}

	function handleSaveNewFromForm(data: Omit<ProviderConfig, 'id'>) {
		const config = addProviderConfig(data);
		if (!settings.roleAssignments['main']) {
			assignRole('main', config.id);
		}
		cancelEdit();
	}

	function handleDelete(id: string) {
		deleteProviderConfig(id);
		if (editingId === id) cancelEdit();
	}

	function handleDuplicate(config: ProviderConfig) {
		const copy = addProviderConfig({
			name: config.name + t('settings.copySuffix'),
			provider: config.provider,
			apiType: config.apiType,
			baseURL: config.baseURL,
			model: config.model,
			apiKey: config.apiKey,
			corsBypassEnabled: config.corsBypassEnabled,
			wispProxyUrl: config.wispProxyUrl,
			callSettings: config.callSettings,
		});
		// Start editing the copy immediately
		startEdit(copy);
	}

	function isEditing(config: ProviderConfig): boolean {
		return editingId === config.id;
	}

	const mainProviderId = $derived(settings.roleAssignments['main']);

	const localeItems = $derived(getLocaleItems());

	const themeModeItems = $derived(getThemeModeItems());

	const colorThemeItems = $derived(getColorThemeItems());

	const logLevelItems = $derived(getLogLevelItems());

	const reviewerModeItems = $derived(getReviewerModeItems());

	const voiceItems = $derived(getVoiceItems());

	let showTTSDownloadModal = $state(false);
	let ttsDownloadProgress = $state<number | null>(null);
	let ttsDownloading = $state(false);
	let ttsDownloadError = $state<string | null>(null);
	let ttsPreviewPlaying = $state(false);

	const TTS_PREVIEW_TEXT = `The Tortoise and the Hare\n\nA Hare was making fun of the Tortoise one day for being so slow. "Do you ever get anywhere?" he asked with a mocking laugh. "Yes," replied the Tortoise, "and I get there sooner than you think. I'll run you a race and prove it." The Hare was much amused at the idea of running a race with the Tortoise, but for the fun of the thing he agreed. So the Fox, who had consented to act as judge, marked the distance and started them off. The Hare was soon far out of sight, and to make the Tortoise feel very deeply how ridiculous it was for him to try a race with a Hare, he lay down beside the road to have a nap. The Tortoise meanwhile kept going slowly but steadily, and, after a time, passed the place where the Hare was sleeping. When the Hare awoke from his nap, he saw the Tortoise was near the winning-post, and could not run up in time to save the race.`;

	function handleTTSPreview(): void {
		if (ttsPreviewPlaying) {
			ttsPlayer.stop();
			ttsPreviewPlaying = false;
			return;
		}
		ttsPreviewPlaying = true;
		const voice = settings.ttsVoice;
		const speed = settings.ttsSpeed;
		ttsPlayer.play(TTS_PREVIEW_TEXT, '__tts_preview__', voice, speed);
	}

	$effect(() => {
		if (ttsPreviewPlaying && ttsPlayer.playingMessageId !== '__tts_preview__') {
			ttsPreviewPlaying = false;
		}
	});

	async function handleToggleTTS(): Promise<void> {
		if (settings.ttsEnabled) {
			await updateSettings({ ttsEnabled: false });
			ttsPlayer.shutdownModel();
			return;
		}

		if (ttsPlayer.isModelLoaded) {
			await updateSettings({ ttsEnabled: true });
			return;
		}

		ttsDownloadError = null;
		const cached = await isTTSModelCached();
		if (cached) {
			await updateSettings({ ttsEnabled: true });
		} else {
			showTTSDownloadModal = true;
		}
	}

	function handleTTSDownload(): void {
		ttsDownloading = true;
		ttsDownloadProgress = 0;
		ttsDownloadError = null;

		ttsPlayer.loadModel({
			onProgress: (progress: number) => {
				ttsDownloadProgress = progress;
			},
			onError: (error: string) => {
				ttsDownloadError = error;
				ttsDownloading = false;
			},
			onReady: () => {
				ttsDownloading = false;
				showTTSDownloadModal = false;
				ttsDownloadProgress = null;
				updateSettings({ ttsEnabled: true });
			},
		});
	}

	function handleTTSDownloadCancel(): void {
		ttsPlayer.cancelLoad();
		showTTSDownloadModal = false;
		ttsDownloadProgress = null;
		ttsDownloadError = null;
		ttsDownloading = false;
	}
</script>

<div class="flex-1 overflow-y-auto p-3 md:p-4 lg:p-6">
	<div class="max-w-2xl mx-auto space-y-8">
		<h1 class="h2 font-display">{t('settings.heading')}</h1>

		<p class="text-sm text-surface-500">{t('settings.settingsAutoSaved')}</p>

		<!-- Appearance -->
		<Card title={t('settings.appearance')} description={t('settings.appearanceDescription')}>
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.locale')}</h3>
				<ThemedSelect items={localeItems} value={settings.locale} onValueChange={(v) => updateSettings({ locale: v })} />
				<span class="text-xs text-surface-500 block">{t('settings.localeDescription')}</span>
			</div>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
					<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.colorTheme')}</h3>
					<ThemedSelect items={colorThemeItems} value={settings.colorTheme} onValueChange={(v) => updateSettings({ colorTheme: v })} />
				</div>
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
					<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.themeMode')}</h3>
					<ThemedSelect
						items={themeModeItems}
						value={settings.themeMode}
						onValueChange={(v) => updateSettings({ themeMode: v as ThemeMode })}
					/>
				</div>
			</div>
		</Card>

		<!-- AI Providers -->
		<Card>
			<div class="flex items-center justify-between">
				<h2 class="h4">{t('settings.aiProviders')}</h2>
				<Button class="min-h-11" onclick={startAdd}>{t('settings.addProvider')}</Button>
			</div>

			{#if settings.providers.length === 0 && !isAddingNew}
				<p class="text-sm text-surface-500 py-2">{t('settings.noProvidersAdd')}</p>
			{/if}

			<!-- Provider List -->
			{#each settings.providers as config (config.id)}
				{#if isEditing(config)}
					<ProviderForm
						mode="edit"
						{config}
						isMainProvider={mainProviderId === config.id}
						onsave={(data) => handleSaveFromForm(config.id, data)}
						oncancel={cancelEdit}
					/>
				{:else}
					<!-- Provider Card -->
					<div
						class="flex items-center justify-between p-3 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150"
					>
						<div class="min-w-0">
							<p class="text-sm font-medium truncate">{config.name}</p>
							<p class="text-xs text-surface-500 truncate">
								{config.provider === 'openai'
									? t('settings.providers.openai')
									: config.provider === 'ollama'
										? t('settings.providers.ollama')
										: t('settings.providers.openaiCompatible')} · {config.model}
							</p>
						</div>
						<div class="flex items-center gap-1 shrink-0">
							<button class="btn preset-tonal text-xs px-2 py-1 min-h-11" type="button" onclick={() => handleDuplicate(config)}>
								{t('settings.copy')}
							</button>
							<button class="btn preset-tonal text-xs px-2 py-1 min-h-11" type="button" onclick={() => startEdit(config)}>
								{t('settings.edit')}
							</button>
							{#if mainProviderId !== config.id}
								<button
									class="btn preset-tonal text-xs px-2 py-1 text-error-700-300 min-h-11"
									type="button"
									onclick={() => handleDelete(config.id)}
								>
									{t('settings.delete')}
								</button>
							{/if}
						</div>
					</div>
				{/if}
			{/each}

			{#if isAddingNew}
				<ProviderForm mode="add" onsave={handleSaveNewFromForm} oncancel={cancelEdit} />
			{/if}
		</Card>

		<!-- Provider Roles -->
		<Card title={t('settings.providerRoles')} description={t('settings.providerRolesDescription')}>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
					<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.mainProvider')}</h3>
					<ThemedSelect
						items={getRoleItems(false)}
						value={mainProviderId}
						onValueChange={(v) => assignRole('main', v)}
						disabled={settings.providers.length === 0}
						placeholder={t('settings.noProvidersConfigured')}
					/>
					<span class="text-xs text-surface-500 block">{t('settings.mainProviderDescription')}</span>
				</div>

				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
					<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.minorTaskAgent')}</h3>
					<ThemedSelect
						items={getRoleItems()}
						value={settings.minorTaskAgentProviderRole}
						onValueChange={(v) => updateSettings({ minorTaskAgentProviderRole: v })}
						disabled={settings.providers.length === 0}
						placeholder={t('settings.noProvidersConfigured')}
					/>
					<span class="text-xs text-surface-500 block">{t('settings.minorTaskAgentDescription')}</span>
				</div>
			</div>
		</Card>

		<!-- Narrative -->
		<Card title={t('settings.narrative')}>
			<!-- Word Count & Compressor: side-by-side mini-cards -->
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
					<NumberField
						label={t('settings.targetWordCount')}
						hint={t('settings.targetWordCountDescription')}
						min={50}
						max={2000}
						step={50}
						value={settings.targetWordCount}
						onValueChange={(v) => {
							if (v >= 50 && v <= 2000) updateSettings({ targetWordCount: v });
						}}
					/>
				</div>

				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
					<NumberField
						label={t('settings.compressorInterval')}
						hint={t('settings.compressorIntervalDescription')}
						min={0}
						max={50}
						step={1}
						value={settings.characterProfileCompressorInterval}
						onValueChange={(v) => {
							if (v >= 0 && v <= 50) updateSettings({ characterProfileCompressorInterval: v });
						}}
					/>
				</div>
			</div>

			<!-- Director Mode & Phrase Highlighting: side-by-side mini-cards -->
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
					<div class="flex items-center gap-2">
						<input
							type="checkbox"
							class="checkbox"
							checked={settings.directorModeEnabled}
							onchange={(e) => updateSettings({ directorModeEnabled: (e.currentTarget as HTMLInputElement).checked })}
						/>
						<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.directorMode')}</h3>
					</div>
					<span class="text-xs text-surface-500 block">{t('settings.directorModeDescription')}</span>
				</div>

				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
					<label class="flex items-center gap-2">
						<input
							type="checkbox"
							class="checkbox"
							checked={settings.importantPhraseHighlighting}
							disabled={!getMinorTaskAgentProviderConfig()}
							onchange={(e) => updateSettings({ importantPhraseHighlighting: (e.currentTarget as HTMLInputElement).checked })}
						/>
						<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.phraseHighlighting')}</h3>
					</label>
					<span class="text-xs text-surface-500 block">{t('settings.phraseHighlightingDescription')}</span>
				</div>
		</div>

		<!-- Phase Advancement Threshold: full-width mini-card -->
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<NumberField
					label={t('settings.phaseAdvancementThreshold')}
					hint={t('settings.phaseAdvancementThresholdDescription')}
					min={0}
					max={10}
					step={1}
					value={settings.phaseAdvancementThreshold}
					onValueChange={(v) => {
						if (v >= 0 && v <= 10) updateSettings({ phaseAdvancementThreshold: v });
					}}
				/>
			</div>
		</Card>

		<!-- Pipeline Roles -->
		<Card title={t('settings.pipelineRoles')} description={t('settings.pipelineRolesDescription')}>
			<!-- Plot Planner: full-width mini-card -->
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.plotPlanner')}</h3>
				<div class="flex items-center gap-2">
					<label class="flex items-center gap-1">
						<input
							type="checkbox"
							class="checkbox"
							checked={settings.plotPlannerEnabled}
							disabled={settings.providers.length === 0}
							onchange={(e) => updateSettings({ plotPlannerEnabled: (e.currentTarget as HTMLInputElement).checked })}
						/>
						<span class="text-xs text-surface-500">{t('settings.enabled')}</span>
					</label>
					<ThemedSelect
						items={getRoleItems()}
						value={settings.plotPlannerProviderRole}
						onValueChange={(v) => updateSettings({ plotPlannerProviderRole: v })}
						disabled={settings.providers.length === 0 || !settings.plotPlannerEnabled}
						placeholder={t('settings.noProvidersConfigured')}
					/>
				</div>
				<p class="text-xs text-surface-500">{t('settings.plotPlannerDescription')} {t('settings.enablePlotPlannerDescription')}</p>
				<div class="flex items-center gap-2">
					<span class="text-xs text-surface-500">{t('settings.plotMode')}</span>
					<ThemedSelect
						items={[
							{ label: t('settings.plotModeGuidance'), value: 'guidance' },
							{ label: t('settings.plotModePhaseEvent'), value: 'phaseEvent' },
						]}
						value={settings.defaultPlotMode}
						onValueChange={(v) => updateSettings({ defaultPlotMode: v as 'guidance' | 'phaseEvent' })}
						disabled={!settings.plotPlannerEnabled}
					/>
				</div>
				<span class="text-xs text-surface-500 block">{t('settings.plotModeDescription')}</span>
				<div class="flex items-center gap-2">
					<span class="text-xs text-surface-500">{t('settings.reevaluationFrequency')}</span>
					<input
						type="number"
						class="input text-xs w-16"
						min="1"
						max="20"
						value={settings.reevaluationFrequency}
						disabled={!settings.plotPlannerEnabled}
						onchange={(e) => {
							const val = parseInt((e.currentTarget as HTMLInputElement).value, 10);
							if (!isNaN(val) && val >= 1 && val <= 20) updateSettings({ reevaluationFrequency: val });
						}}
					/>
				</div>
				<span class="text-xs text-surface-500 block">{t('settings.reevaluationFrequencyDescription')}</span>
			</div>

			<!-- Reviewer: full-width mini-card -->
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.reviewer')}</h3>
				<div class="flex items-center gap-2">
					<label class="flex items-center gap-1">
						<input
							type="checkbox"
							class="checkbox"
							checked={settings.reviewerEnabled}
							disabled={settings.providers.length === 0}
							onchange={(e) => updateSettings({ reviewerEnabled: (e.currentTarget as HTMLInputElement).checked })}
						/>
						<span class="text-xs text-surface-500">{t('settings.enabled')}</span>
					</label>
					<ThemedSelect
						items={getRoleItems()}
						value={settings.reviewerProviderRole}
						onValueChange={(v) => updateSettings({ reviewerProviderRole: v })}
						disabled={settings.providers.length === 0 || !settings.reviewerEnabled}
						placeholder={t('settings.noProvidersConfigured')}
					/>
				</div>
				<p class="text-xs text-surface-500">{t('settings.reviewerDescription')} {t('settings.enableReviewerDescription')}</p>
				<div>
					<span class="text-xs font-medium text-surface-500">{t('settings.reviewerMode')}</span>
					<ThemedSelect
						items={reviewerModeItems}
						value={settings.reviewerMode}
						onValueChange={(v) => updateSettings({ reviewerMode: v as 'detailed' | 'quick' })}
						disabled={!settings.reviewerEnabled}
					/>
					<span class="text-xs text-surface-500 block mt-1"
						>{settings.reviewerMode === 'detailed'
							? t('settings.reviewerModeDetailedDescription')
							: t('settings.reviewerModeQuickDescription')}</span
					>
				</div>
			</div>

			<!-- 2x2 grid: Writer, Editor, Game Master, Summarizer -->
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<!-- Writer -->
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
					<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.writer')}</h3>
					<ThemedSelect
						items={getRoleItems()}
						value={settings.writerProviderRole}
						onValueChange={(v) => updateSettings({ writerProviderRole: v })}
						disabled={settings.providers.length === 0}
						placeholder={t('settings.noProvidersConfigured')}
					/>
					<span class="text-xs text-surface-500 block">{t('settings.writerDescription')}</span>
				</div>

				<!-- Editor -->
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
					<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.editor')}</h3>
					<ThemedSelect
						items={getRoleItems()}
						value={settings.editorProviderRole}
						onValueChange={(v) => updateSettings({ editorProviderRole: v })}
						disabled={!settings.reviewerEnabled || settings.providers.length === 0}
						placeholder={t('settings.noProvidersConfigured')}
					/>
					<span class="text-xs text-surface-500 block">{t('settings.editorDescription')}</span>
					{#if !settings.reviewerEnabled}
						<span class="text-xs text-surface-500">{t('settings.editorRequiresReviewer')}</span>
					{/if}
				</div>

				<!-- Game Master -->
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
					<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.gameMaster')}</h3>
					<ThemedSelect
						items={getRoleItems()}
						value={settings.gameMasterProviderRole}
						onValueChange={(v) => updateSettings({ gameMasterProviderRole: v })}
						disabled={settings.providers.length === 0}
						placeholder={t('settings.noProvidersConfigured')}
					/>
					<span class="text-xs text-surface-500 block">{t('settings.gameMasterDescription')}</span>
				</div>

				<!-- Summarizer -->
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
					<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.summarizer')}</h3>
					<ThemedSelect
						items={getRoleItems()}
						value={settings.summarizerProviderRole}
						onValueChange={(v) => updateSettings({ summarizerProviderRole: v })}
						disabled={settings.providers.length === 0}
						placeholder={t('settings.noProvidersConfigured')}
					/>
					<span class="text-xs text-surface-500 block">{t('settings.summarizerDescription')}</span>
				</div>
			</div>
		</Card>

		<!-- Data -->
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
							{gameIO.isExporting ? '...' : t('settings.exportGameData')}
						</button>
						<label class="btn preset-outlined cursor-pointer text-xs px-3 py-1 min-h-9">
							{gameIO.isImporting ? '...' : t('settings.importGameData')}
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
							{configIO.isExporting ? '...' : t('settings.exportConfigData')}
						</button>
						<label class="btn preset-outlined cursor-pointer text-xs px-3 py-1 min-h-9">
							{configIO.isImporting ? '...' : t('settings.importConfigData')}
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

		<!-- Text-to-Speech -->
		<Card title={t('tts.tts')} description={t('tts.ttsDescription')}>
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<label class="flex items-center gap-2">
					<input type="checkbox" class="checkbox" checked={settings.ttsEnabled} onchange={handleToggleTTS} />
					<h3 class="text-sm font-semibold text-surface-700-300">{t('tts.enableTts')}</h3>
				</label>
				<span class="text-xs text-surface-500 block">{t('tts.ttsLanguageNote')}</span>
			</div>
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<h3 class="text-sm font-semibold text-surface-700-300">{t('tts.speed')}</h3>
				<span class="text-xs text-surface-500 block">{t('tts.speedDescription')}</span>
				<div class="flex items-center gap-3">
					<input
						type="range"
						class="flex-1 cursor-pointer"
						min={TTS_SPEED_MIN}
						max={TTS_SPEED_MAX}
						step={TTS_SPEED_STEP}
						value={settings.ttsSpeed}
						disabled={!settings.ttsEnabled}
						oninput={(e) => updateSettings({ ttsSpeed: parseFloat((e.target as HTMLInputElement).value) })}
					/>
					<span class="text-sm tabular-nums min-w-[3ch] text-surface-700-300">{settings.ttsSpeed.toFixed(1)}×</span>
				</div>
			</div>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
					<h3 class="text-sm font-semibold text-surface-700-300">{t('tts.voice')}</h3>
					<ThemedSelect
						items={voiceItems}
						value={settings.ttsVoice}
						onValueChange={(v) => updateSettings({ ttsVoice: v })}
						disabled={!settings.ttsEnabled}
					/>
					<span class="text-xs text-surface-500 block">{t('tts.voiceDescription')}</span>
				</div>
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
					<h3 class="text-sm font-semibold text-surface-700-300">{t('tts.preview')}</h3>
					<span class="text-xs text-surface-500 block">{t('tts.previewDescription')}</span>
					<button
						type="button"
						class="px-4 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium transition-colors min-h-11"
						onclick={handleTTSPreview}
						disabled={!settings.ttsEnabled}
					>
						{ttsPreviewPlaying ? t('tts.stop') : t('tts.preview')}
					</button>
					{#if ttsPreviewPlaying}
						<span class="text-xs text-surface-500 block">{t('tts.previewPlaying')}</span>
					{/if}
				</div>
			</div>
		</Card>

		{#if isMemoryCapable()}
			<!-- Memory -->
			<Card title={t('settings.memory')} description={t('settings.enableMemoryDescription')}>
				<label class="flex items-center gap-2">
					<input
						type="checkbox"
						class="checkbox"
						checked={settings.memoryEnabled}
						onchange={(e) => updateSettings({ memoryEnabled: (e.currentTarget as HTMLInputElement).checked })}
						disabled={!isMemoryCapable()}
					/>
					<span class="text-sm font-medium text-surface-700-300">{t('settings.enableMemory')}</span>
				</label>

				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">{t('settings.memoryProvider')}</span>
					<ThemedSelect
						items={getRoleItems()}
						value={settings.memoryProviderRole}
						onValueChange={(v) => updateSettings({ memoryProviderRole: v })}
						disabled={!settings.memoryEnabled || !isMemoryAvailable()}
						placeholder={t('settings.noProvidersConfigured')}
					/>
					<span class="text-xs text-surface-500 mt-1 block">{t('settings.memoryProviderDescription')}</span>
				</label>

				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">{t('settings.embeddingProvider')}</span>
					<ThemedSelect
						items={getRoleItems()}
						value={settings.embeddingProviderRole}
						onValueChange={(v) => updateSettings({ embeddingProviderRole: v })}
						disabled={!settings.memoryEnabled || !isMemoryAvailable()}
						placeholder={t('settings.noProvidersConfigured')}
					/>
					<span class="text-xs text-surface-500 mt-1 block">{t('settings.embeddingProviderDescription')}</span>
				</label>
			</Card>
		{/if}

		<!-- Developer -->
		<Card title={t('settings.developer')}>
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.logLevel')}</h3>
				<ThemedSelect items={logLevelItems} value={settings.logLevel} onValueChange={(v) => updateSettings({ logLevel: v as LogLevel })} />
				<span class="text-xs text-surface-500 block">{t('settings.logLevelDescription')}</span>
			</div>
		</Card>
	</div>
</div>

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

<Modal bind:open={showTTSDownloadModal} title={t('tts.downloadModelTitle')}>
	{#snippet body()}
		<p class="text-sm text-surface-700-300">{t('tts.downloadModelDescription')}</p>
		{#if ttsDownloadProgress !== null}
			<ProgressField value={ttsDownloadProgress} label={`${ttsDownloadProgress}%`} visible={true} />
		{/if}
		{#if ttsDownloadError}
			<p class="text-sm text-error-500 mt-2">{ttsDownloadError}</p>
		{/if}
	{/snippet}
	{#snippet footer()}
		<div class="flex gap-2">
			<button
				class="flex-1 px-4 py-2 rounded-lg bg-surface-200-800 hover:bg-surface-300-700 text-surface-700-300 text-sm transition-colors min-h-11"
				type="button"
				disabled={ttsDownloading}
				onclick={handleTTSDownloadCancel}
			>
				{t('tts.cancelDownload')}
			</button>
			<button
				class="flex-1 px-4 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium transition-colors min-h-11"
				type="button"
				disabled={ttsDownloading}
				onclick={handleTTSDownload}
			>
				{ttsDownloading ? t('tts.downloading') : t('tts.startDownload')}
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
