<script lang="ts">
	import { Progress } from '@skeletonlabs/skeleton-svelte';
	import {
		addProviderConfig,
		type ApiType,
		assignRole,
		deleteProviderConfig,
		getMinorTaskAgentProviderConfig,
		isMemoryAvailable,
		isMemoryCapable,
		type LogLevel,
		type Provider,
		type ProviderConfig,
		resetConfiguration,
		settings,
		updateProviderConfig,
		updateSettings,
	} from '$lib/stores/settings.svelte';
	import { fetchModels, type ModelInfo } from '$lib/ai/models';
	import { t } from '$lib/i18n';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import {
		downloadExport,
		exportConfigData,
		exportGameData,
		importConfigData,
		importGameData,
		readFileAsUint8Array,
	} from '$lib/db/data-portability';
	import { isTauriSync } from '$lib/runtime';
	import { ensureAllBaseConfigs } from '$lib/fs/prompt-loader';

	// Editing state
	let editingId = $state<string | null>(null);
	let isAddingNew = $state(false);

	// Data import/export state
	let isExportingGame = $state(false);
	let isImportingGame = $state(false);
	let gameImportError = $state<string | null>(null);
	let showGameImportConfirm = $state(false);
	let pendingGameImportFile = $state<File | null>(null);

	let isExportingConfig = $state(false);
	let isImportingConfig = $state(false);
	let configImportError = $state<string | null>(null);
	let showConfigImportConfirm = $state(false);
	let pendingConfigImportFile = $state<File | null>(null);

	let exportProgress = $state<number | null>(null);
	let isImporting = $state(false);

	let showResetConfirm = $state(false);
	let isResetting = $state(false);

	async function handleExportGameData() {
		isExportingGame = true;
		gameImportError = null;
		exportProgress = 0;
		try {
			const data = await exportGameData((percent: number) => (exportProgress = Math.round(percent)));
			const ts = new Date().toISOString().slice(0, 10);
			await downloadExport(data, `byoa-game-data-${ts}.zip`);
		} catch (err) {
			gameImportError = t('settings.exportFailed', { error: err instanceof Error ? err.message : String(err) });
		} finally {
			isExportingGame = false;
			exportProgress = null;
		}
	}

	function handleImportGameData(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		pendingGameImportFile = file;
		showGameImportConfirm = true;
		(e.currentTarget as HTMLInputElement).value = '';
	}

	function handleImportGameDataCancel() {
		showGameImportConfirm = false;
		pendingGameImportFile = null;
	}

	async function handleImportGameDataConfirm() {
		showGameImportConfirm = false;
		if (!pendingGameImportFile) return;
		isImportingGame = true;
		isImporting = true;
		gameImportError = null;
		try {
			const data = await readFileAsUint8Array(pendingGameImportFile);
			await importGameData(data);
			window.location.reload();
		} catch (err) {
			gameImportError = t('settings.importFailed', { error: err instanceof Error ? err.message : String(err) });
			isImportingGame = false;
			isImporting = false;
		} finally {
			pendingGameImportFile = null;
		}
	}

	async function handleExportConfigData() {
		isExportingConfig = true;
		configImportError = null;
		exportProgress = 0;
		try {
			const data = await exportConfigData((percent: number) => (exportProgress = Math.round(percent)));
			const ts = new Date().toISOString().slice(0, 10);
			await downloadExport(data, `byoa-config-${ts}.zip`);
		} catch (err) {
			configImportError = t('settings.exportFailed', { error: err instanceof Error ? err.message : String(err) });
		} finally {
			isExportingConfig = false;
			exportProgress = null;
		}
	}

	function handleImportConfigData(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		pendingConfigImportFile = file;
		showConfigImportConfirm = true;
		(e.currentTarget as HTMLInputElement).value = '';
	}

	function handleImportConfigDataCancel() {
		showConfigImportConfirm = false;
		pendingConfigImportFile = null;
	}

	async function handleImportConfigDataConfirm() {
		showConfigImportConfirm = false;
		if (!pendingConfigImportFile) return;
		isImportingConfig = true;
		isImporting = true;
		configImportError = null;
		try {
			const data = await readFileAsUint8Array(pendingConfigImportFile);
			await importConfigData(data);
			window.location.reload();
		} catch (err) {
			configImportError = t('settings.importFailed', { error: err instanceof Error ? err.message : String(err) });
			isImportingConfig = false;
			isImporting = false;
		} finally {
			pendingConfigImportFile = null;
		}
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

	// Form state for the provider being edited/added
	let formName = $state('');
	let formProvider = $state<Provider>('openai');
	let formApiType = $state<ApiType>('responses');
	let formBaseURL = $state('https://api.openai.com/v1');
	let formModel = $state('');
	let formApiKey = $state('');
	let formCorsBypassEnabled = $state(false);
	let formWispProxyUrl = $state('ws://localhost:6001');

	// Model fetching
	let availableModels = $state<ModelInfo[]>([]);
	let isLoadingModels = $state(false);
	let modelsError = $state<string | null>(null);

	function resetForm() {
		formName = '';
		formProvider = 'openai';
		formApiType = 'responses';
		formBaseURL = 'https://api.openai.com/v1';
		formModel = '';
		formApiKey = '';
		formCorsBypassEnabled = false;
		formWispProxyUrl = 'ws://localhost:6001';
		availableModels = [];
		modelsError = null;
	}

	function startEdit(config: ProviderConfig) {
		editingId = config.id;
		isAddingNew = false;
		formName = config.name;
		formProvider = config.provider;
		formApiType = config.apiType;
		formBaseURL = config.baseURL;
		formModel = config.model;
		formApiKey = config.apiKey;
		formCorsBypassEnabled = config.corsBypassEnabled;
		formWispProxyUrl = config.wispProxyUrl;
		availableModels = [];
		modelsError = null;
	}

	function startAdd() {
		resetForm();
		isAddingNew = true;
		editingId = null;
	}

	function cancelEdit() {
		editingId = null;
		isAddingNew = false;
		resetForm();
	}

	function handleProviderChange() {
		if (formProvider === 'openai-compatible') {
			formBaseURL = 'http://localhost:1234/v1';
		} else if (formProvider === 'ollama') {
			formBaseURL = 'https://ollama.com';
		} else if (formProvider === 'openai') {
			formBaseURL = 'https://api.openai.com/v1';
		} else {
			formBaseURL = '';
		}
	}

	function handleSaveNew() {
		const config = addProviderConfig({
			name: formName || t('settings.untitledProvider'),
			provider: formProvider,
			apiType: formApiType,
			baseURL: formBaseURL,
			model: formModel,
			apiKey: formApiKey,
			corsBypassEnabled: formCorsBypassEnabled,
			wispProxyUrl: formWispProxyUrl,
		});
		// If no main provider assigned, make this the main one
		if (!settings.roleAssignments['main']) {
			assignRole('main', config.id);
		}
		cancelEdit();
	}

	function handleSaveEdit() {
		if (!editingId) return;
		updateProviderConfig(editingId, {
			name: formName,
			provider: formProvider,
			apiType: formApiType,
			baseURL: formBaseURL,
			model: formModel,
			apiKey: formApiKey,
			corsBypassEnabled: formCorsBypassEnabled,
			wispProxyUrl: formWispProxyUrl,
		});
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
		});
		// Start editing the copy immediately
		startEdit(copy);
	}

	async function handleFetchModels() {
		isLoadingModels = true;
		modelsError = null;
		try {
			availableModels = await fetchModels({
				baseURL: formBaseURL,
				apiKey: formApiKey,
				provider: formProvider,
				corsBypassEnabled: formCorsBypassEnabled,
				wispProxyUrl: formWispProxyUrl,
			});
		} catch (err: unknown) {
			modelsError = err instanceof Error ? err.message : t('settings.failedToFetchModels');
			availableModels = [];
		} finally {
			isLoadingModels = false;
		}
	}

	function isEditing(config: ProviderConfig): boolean {
		return editingId === config.id;
	}

	const mainProviderId = $derived(settings.roleAssignments['main']);

	const providerItems: { label: string; value: string }[] = [
		{ label: t('settings.providers.openaiCompatible'), value: 'openai-compatible' },
		{ label: t('settings.providers.openai'), value: 'openai' },
		{ label: t('settings.providers.ollama'), value: 'ollama' },
	];

	const apiTypeItems: { label: string; value: string }[] = [
		{ label: t('settings.apiTypes.responses'), value: 'responses' },
		{ label: t('settings.apiTypes.chatCompletions'), value: 'chat-completions' },
	];

	const localeItems: { label: string; value: string }[] = [
		{ label: 'English', value: 'en' },
		{ label: '繁體中文（香港）', value: 'zh-Hant-HK' },
	];

	const logLevelItems: { label: string; value: string }[] = [
		{ label: t('settings.logLevels.error'), value: 'error' },
		{ label: t('settings.logLevels.warn'), value: 'warn' },
		{ label: t('settings.logLevels.info'), value: 'info' },
		{ label: t('settings.logLevels.debug'), value: 'debug' },
	];

	const reviewerModeItems: { label: string; value: string }[] = [
		{ label: t('settings.reviewerModeDetailed'), value: 'detailed' },
		{ label: t('settings.reviewerModeQuick'), value: 'quick' },
	];

	function roleItems(includeMain: boolean = true): { label: string; value: string }[] {
		const items: { label: string; value: string }[] = [];
		if (includeMain) items.push({ label: t('settings.mainProvider'), value: 'main' });
		for (const c of settings.providers) items.push({ label: c.name, value: c.id });
		return items;
	}
</script>

<div class="flex-1 overflow-y-auto p-4 md:p-6">
	<div class="max-w-2xl mx-auto space-y-8">
		<h1 class="h2 font-display">{t('settings.heading')}</h1>

		<p class="text-sm text-surface-500">{t('settings.settingsAutoSaved')}</p>

		<!-- AI Providers -->
		<section class="card p-4 md:p-6 space-y-4">
			<div class="flex items-center justify-between">
				<h2 class="h4">{t('settings.aiProviders')}</h2>
				<button class="btn preset-tonal" type="button" onclick={startAdd}> {t('settings.addProvider')} </button>
			</div>

			{#if settings.providers.length === 0 && !isAddingNew}
				<p class="text-sm text-surface-500 py-2">{t('settings.noProvidersAdd')}</p>
			{/if}

			<!-- Provider List -->
			{#each settings.providers as config (config.id)}
				{#if isEditing(config)}
					<!-- Edit Form -->
					<div class="card p-4 space-y-3 border border-primary-500-300">
						{#each settings.providers as c (c)}
							{#if c.id === config.id}
								{@const isMain = mainProviderId === config.id}
								<p class="text-xs text-surface-500">
									{t('settings.editing')}{#if isMain}
										{t('settings.mainProviderTag')}{/if}
								</p>
							{/if}
						{/each}
						<details open>
							<summary class="text-sm font-medium cursor-pointer">{formName || t('settings.untitled')}</summary>
							<div class="mt-3 space-y-3">
								<label class="block">
									<span class="text-sm font-medium text-surface-700-300">{t('settings.name')}</span>
									<input class="input mt-1" type="text" placeholder={t('settings.namePlaceholder')} bind:value={formName} />
								</label>

								<label class="block">
									<span class="text-sm font-medium text-surface-700-300">{t('settings.apiProvider')}</span>
									<ThemedSelect
										items={providerItems}
										value={formProvider}
										onValueChange={(v) => {
											formProvider = v as Provider;
											handleProviderChange();
										}}
									/>
								</label>

								{#if formProvider === 'openai'}
									<label class="block">
										<span class="text-sm font-medium text-surface-700-300">{t('settings.apiType')}</span>
										<ThemedSelect items={apiTypeItems} value={formApiType} onValueChange={(v) => (formApiType = v as ApiType)} />
										<span class="text-xs text-surface-500 mt-1 block">{t('settings.apiTypeHint')}</span>
									</label>
								{/if}

								<label class="block">
									<span class="text-sm font-medium text-surface-700-300">{t('settings.baseUrl')}</span>
									<input class="input mt-1" type="url" placeholder="https://api.openai.com/v1" bind:value={formBaseURL} />
									<span class="text-xs text-surface-500 mt-1 block">{t('settings.baseUrlHint')}</span>
								</label>

								<div>
									<div class="flex items-end gap-2">
										<label class="flex-1">
											<span class="text-sm font-medium text-surface-700-300">{t('settings.model')}</span>
											{#if availableModels.length > 0}
												<ThemedSelect
													items={availableModels.map((m) => ({ label: m.id, value: m.id }))}
													value={formModel}
													onValueChange={(v) => (formModel = v)}
												/>
											{:else}
												<input class="input mt-1" type="text" placeholder={t('settings.modelPlaceholder')} bind:value={formModel} />
											{/if}
										</label>
										<button class="btn preset-tonal shrink-0" type="button" onclick={handleFetchModels} disabled={isLoadingModels}>
											{isLoadingModels ? t('settings.loading') : t('settings.fetchModels')}
										</button>
									</div>
									{#if availableModels.length > 0}
										<label class="block mt-2">
											<span class="text-xs text-surface-500">{t('settings.modelOrType')}</span>
											<input class="input mt-1" type="text" placeholder={t('settings.modelPlaceholder')} bind:value={formModel} />
										</label>
									{/if}
									{#if modelsError}
										<p class="text-xs text-error-700-300 mt-1">{modelsError}</p>
									{/if}
								</div>

								<label class="block">
									<span class="text-sm font-medium text-surface-700-300">{t('settings.apiKey')}</span>
									<input class="input mt-1" type="password" placeholder="sk-..." bind:value={formApiKey} />
									<span class="text-xs text-surface-500 mt-1 block">{t('settings.apiKeyHint')}</span>
								</label>
							</div>
						</details>
						<div class="flex gap-2">
							<button class="btn preset-filled" type="button" onclick={handleSaveEdit}> {t('settings.save')} </button>
							<button class="btn preset-tonal" type="button" onclick={cancelEdit}> {t('settings.cancel')} </button>
						</div>
					</div>
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
							<button class="btn preset-tonal text-xs px-2 py-1" type="button" onclick={() => handleDuplicate(config)}>
								{t('settings.copy')}
							</button>
							<button class="btn preset-tonal text-xs px-2 py-1" type="button" onclick={() => startEdit(config)}>
								{t('settings.edit')}
							</button>
							{#if mainProviderId !== config.id}
								<button class="btn preset-tonal text-xs px-2 py-1 text-error-700-300" type="button" onclick={() => handleDelete(config.id)}>
									{t('settings.delete')}
								</button>
							{/if}
						</div>
					</div>
				{/if}
			{/each}

			<!-- Add New Provider Form -->
			{#if isAddingNew}
				<div class="card p-4 space-y-3 border border-primary-500-300">
					<p class="text-xs text-surface-500">{t('settings.newProvider')}</p>
					<details open>
						<summary class="text-sm font-medium cursor-pointer">{formName || t('settings.newProviderTitle')}</summary>
						<div class="mt-3 space-y-3">
							<label class="block">
								<span class="text-sm font-medium text-surface-700-300">{t('settings.name')}</span>
								<input class="input mt-1" type="text" placeholder={t('settings.namePlaceholder')} bind:value={formName} />
							</label>

							<label class="block">
								<span class="text-sm font-medium text-surface-700-300">{t('settings.apiProvider')}</span>
								<ThemedSelect
									items={providerItems}
									value={formProvider}
									onValueChange={(v) => {
										formProvider = v as Provider;
										handleProviderChange();
									}}
								/>
							</label>

							{#if formProvider === 'openai'}
								<label class="block">
									<span class="text-sm font-medium text-surface-700-300">{t('settings.apiType')}</span>
									<ThemedSelect items={apiTypeItems} value={formApiType} onValueChange={(v) => (formApiType = v as ApiType)} />
									<span class="text-xs text-surface-500 mt-1 block">{t('settings.apiTypeHint')}</span>
								</label>
							{/if}

							<label class="block">
								<span class="text-sm font-medium text-surface-700-300">{t('settings.baseUrl')}</span>
								<input class="input mt-1" type="url" placeholder="https://api.openai.com/v1" bind:value={formBaseURL} />
								<span class="text-xs text-surface-500 mt-1 block">{t('settings.baseUrlHint')}</span>
							</label>

							<div>
								<div class="flex items-end gap-2">
									<label class="flex-1">
										<span class="text-sm font-medium text-surface-700-300">{t('settings.model')}</span>
										{#if availableModels.length > 0}
											<ThemedSelect
												items={availableModels.map((m) => ({ label: m.id, value: m.id }))}
												value={formModel}
												onValueChange={(v) => (formModel = v)}
											/>
										{:else}
											<input class="input mt-1" type="text" placeholder={t('settings.modelPlaceholder')} bind:value={formModel} />
										{/if}
									</label>
									<button class="btn preset-tonal shrink-0" type="button" onclick={handleFetchModels} disabled={isLoadingModels}>
										{isLoadingModels ? t('settings.loading') : t('settings.fetchModels')}
									</button>
								</div>
								{#if availableModels.length > 0}
									<label class="block mt-2">
										<span class="text-xs text-surface-500">{t('settings.modelOrType')}</span>
										<input class="input mt-1" type="text" placeholder={t('settings.modelPlaceholder')} bind:value={formModel} />
									</label>
								{/if}
								{#if modelsError}
									<p class="text-xs text-error-700-300 mt-1">{modelsError}</p>
								{/if}
							</div>

							<label class="block">
								<span class="text-sm font-medium text-surface-700-300">{t('settings.apiKey')}</span>
								<input class="input mt-1" type="password" placeholder="sk-..." bind:value={formApiKey} />
								<span class="text-xs text-surface-500 mt-1 block">{t('settings.apiKeyHint')}</span>
							</label>

							{#if !isTauriSync()}
								<label class="flex items-center gap-2">
									<input type="checkbox" class="checkbox" bind:checked={formCorsBypassEnabled} />
									<span class="text-sm font-medium text-surface-700-300">Bypass CORS via Wisp proxy</span>
								</label>
								{#if formCorsBypassEnabled}
									<label class="block">
										<span class="text-sm font-medium text-surface-700-300">Wisp Proxy URL</span>
										<input class="input mt-1" type="url" placeholder="ws://localhost:6001" bind:value={formWispProxyUrl} />
										<span class="text-xs text-surface-500 mt-1 block"
											>Connects to a Wisp proxy server (e.g. wisp-server-python) to route API requests without browser CORS restrictions.</span
										>
									</label>
								{/if}
							{/if}
						</div>
					</details>
					<div class="flex gap-2">
						<button class="btn preset-filled" type="button" onclick={handleSaveNew}> {t('settings.addProviderButton')} </button>
						<button class="btn preset-tonal" type="button" onclick={cancelEdit}> {t('settings.cancel')} </button>
					</div>
				</div>
			{/if}
		</section>

		<!-- Provider Roles -->
		<section class="card p-4 md:p-6 space-y-4">
			<h2 class="h4">{t('settings.providerRoles')}</h2>
			<span class="text-xs text-surface-500">{t('settings.providerRolesDescription')}</span>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.mainProvider')}</span>
				<ThemedSelect
					items={roleItems(false)}
					value={mainProviderId}
					onValueChange={(v) => assignRole('main', v)}
					disabled={settings.providers.length === 0}
					placeholder={t('settings.noProvidersConfigured')}
				/>
			</label>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.minorTaskAgent')}</span>
				<ThemedSelect
					items={roleItems()}
					value={settings.minorTaskAgentProviderRole}
					onValueChange={(v) => updateSettings({ minorTaskAgentProviderRole: v })}
					disabled={settings.providers.length === 0}
					placeholder={t('settings.noProvidersConfigured')}
				/>
				<span class="text-xs text-surface-500 mt-1 block">{t('settings.minorTaskAgentDescription')}</span>
			</label>

			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					class="checkbox"
					checked={settings.importantPhraseHighlighting}
					disabled={!getMinorTaskAgentProviderConfig()}
					onchange={(e) => updateSettings({ importantPhraseHighlighting: (e.currentTarget as HTMLInputElement).checked })}
				/>
				<span class="text-sm font-medium text-surface-700-300">{t('settings.phraseHighlighting')}</span>
			</label>
			<span class="text-xs text-surface-500">{t('settings.phraseHighlightingDescription')}</span>
		</section>

		{#if isMemoryCapable()}
			<!-- Memory -->
			<section class="card p-4 md:p-6 space-y-4">
				<h2 class="h4">{t('settings.memory')}</h2>
				<span class="text-xs text-surface-500">{t('settings.enableMemoryDescription')}</span>

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
						items={roleItems()}
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
						items={roleItems()}
						value={settings.embeddingProviderRole}
						onValueChange={(v) => updateSettings({ embeddingProviderRole: v })}
						disabled={!settings.memoryEnabled || !isMemoryAvailable()}
						placeholder={t('settings.noProvidersConfigured')}
					/>
					<span class="text-xs text-surface-500 mt-1 block">{t('settings.embeddingProviderDescription')}</span>
				</label>
			</section>
		{/if}

		<!-- Director Mode -->
		<section class="card p-4 md:p-6 space-y-4">
			<h2 class="h4">{t('settings.directorMode')}</h2>
			<span class="text-xs text-surface-500">{t('settings.directorModeDescription')}</span>

			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					class="checkbox"
					checked={settings.directorModeEnabled}
					onchange={(e) => updateSettings({ directorModeEnabled: (e.currentTarget as HTMLInputElement).checked })}
				/>
				<span class="text-sm font-medium text-surface-700-300">{t('settings.enabled')}</span>
			</label>
		</section>

		<!-- Pipeline Roles -->
		<section class="card p-4 md:p-6 space-y-4">
			<h2 class="h4">{t('settings.pipelineRoles')}</h2>
			<span class="text-xs text-surface-500">{t('settings.pipelineRolesDescription')}</span>

			<div class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.plotPlanner')}</span>
				<div class="flex items-center gap-2 mt-1">
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
						items={roleItems()}
						value={settings.plotPlannerProviderRole}
						onValueChange={(v) => updateSettings({ plotPlannerProviderRole: v })}
						disabled={settings.providers.length === 0 || !settings.plotPlannerEnabled}
						placeholder={t('settings.noProvidersConfigured')}
					/>
				</div>
				<span class="text-xs text-surface-500 mt-1 block">{t('settings.plotPlannerDescription')}</span>
				<span class="text-xs text-surface-500 block">{t('settings.enablePlotPlannerDescription')}</span>
				<div class="flex items-center gap-2 mt-2">
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
				<div class="flex items-center gap-2 mt-2">
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

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.writer')}</span>
				<ThemedSelect
					items={roleItems()}
					value={settings.writerProviderRole}
					onValueChange={(v) => updateSettings({ writerProviderRole: v })}
					disabled={settings.providers.length === 0}
					placeholder={t('settings.noProvidersConfigured')}
				/>
				<span class="text-xs text-surface-500 mt-1 block">{t('settings.writerDescription')}</span>
			</label>

			<div class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.reviewer')}</span>
				<div class="flex items-center gap-2 mt-1">
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
						items={roleItems()}
						value={settings.reviewerProviderRole}
						onValueChange={(v) => updateSettings({ reviewerProviderRole: v })}
						disabled={settings.providers.length === 0 || !settings.reviewerEnabled}
						placeholder={t('settings.noProvidersConfigured')}
					/>
				</div>
				<span class="text-xs text-surface-500 mt-1 block">{t('settings.reviewerDescription')}</span>
				<span class="text-xs text-surface-500 block">{t('settings.enableReviewerDescription')}</span>
				<div class="mt-2">
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

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.editor')}</span>
				<ThemedSelect
					items={roleItems()}
					value={settings.editorProviderRole}
					onValueChange={(v) => updateSettings({ editorProviderRole: v })}
					disabled={!settings.reviewerEnabled || settings.providers.length === 0}
					placeholder={t('settings.noProvidersConfigured')}
				/>
				<span class="text-xs text-surface-500 mt-1 block">{t('settings.editorDescription')}</span>
			</label>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.gameMaster')}</span>
				<ThemedSelect
					items={roleItems()}
					value={settings.gameMasterProviderRole}
					onValueChange={(v) => updateSettings({ gameMasterProviderRole: v })}
					disabled={settings.providers.length === 0}
					placeholder={t('settings.noProvidersConfigured')}
				/>
				<span class="text-xs text-surface-500 mt-1 block">{t('settings.gameMasterDescription')}</span>
			</label>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.summarizer')}</span>
				<ThemedSelect
					items={roleItems()}
					value={settings.summarizerProviderRole}
					onValueChange={(v) => updateSettings({ summarizerProviderRole: v })}
					disabled={settings.providers.length === 0}
					placeholder={t('settings.noProvidersConfigured')}
				/>
				<span class="text-xs text-surface-500 mt-1 block">{t('settings.summarizerDescription')}</span>
			</label>
		</section>

		<!-- Narrative -->
		<section class="card p-4 md:p-6 space-y-4">
			<h2 class="h4">{t('settings.narrative')}</h2>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.targetWordCount')}</span>
				<input
					type="number"
					class="input mt-1 w-32"
					min="50"
					max="2000"
					step="50"
					value={settings.targetWordCount}
					onchange={(e) => {
						const val = parseInt((e.currentTarget as HTMLInputElement).value, 10);
						if (!isNaN(val) && val >= 50 && val <= 2000) updateSettings({ targetWordCount: val });
					}}
				/>
				<span class="text-xs text-surface-500 mt-1 block">{t('settings.targetWordCountDescription')}</span>
			</label>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.compressorInterval')}</span>
				<input
					type="number"
					class="input mt-1 w-32"
					min="0"
					max="50"
					step="1"
					value={settings.characterProfileCompressorInterval}
					onchange={(e) => {
						const val = parseInt((e.currentTarget as HTMLInputElement).value, 10);
						if (!isNaN(val) && val >= 0 && val <= 50) updateSettings({ characterProfileCompressorInterval: val });
					}}
				/>
				<span class="text-xs text-surface-500 mt-1 block">{t('settings.compressorIntervalDescription')}</span>
			</label>
		</section>

		<!-- Data -->
		<section class="card p-4 md:p-6 space-y-4">
			<h2 class="h4">{t('settings.data')}</h2>
			<span class="text-xs text-surface-500">{t('settings.dataDescription')}</span>

			{#if !isTauriSync()}
				<p class="text-xs text-warning-500">{t('settings.dataWebNotice')}</p>
			{/if}

			<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.gameData')}</h3>
			<span class="text-xs text-surface-500">{t('settings.gameDataDescription')}</span>
			<div class="space-y-3">
				<div>
					<button class="btn variant-filled" disabled={isExportingGame} onclick={handleExportGameData}>
						{isExportingGame ? '...' : t('settings.exportGameData')}
					</button>
					<span class="text-xs text-surface-500 mt-1 block">{t('settings.exportGameDataDescription')}</span>
					{#if exportProgress !== null && isExportingGame}
						<Progress value={exportProgress} class="mt-2">
							<Progress.Track>
								<Progress.Range />
							</Progress.Track>
						</Progress>
						<span class="text-xs text-surface-500">{exportProgress}%</span>
					{/if}
				</div>

				<div>
					<label class="btn variant-outline cursor-pointer">
						{isImportingGame ? '...' : t('settings.importGameData')}
						<input type="file" accept=".zip" class="sr-only" disabled={isImportingGame} onchange={handleImportGameData} />
					</label>
					<span class="text-xs text-surface-500 mt-1 block">{t('settings.importGameDataDescription')}</span>
					<span class="text-xs text-warning-500 mt-1 block">{t('settings.importRecommendExport')}</span>
					<span class="text-xs text-error-500 mt-1 block">{t('settings.importGameDataWarning')}</span>
				</div>

				{#if gameImportError}
					<p class="text-xs text-error-500">{gameImportError}</p>
				{/if}
			</div>

			<hr class="border-surface-200-800" />

			<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.configData')}</h3>
			<span class="text-xs text-surface-500">{t('settings.configDataDescription')}</span>
			<div class="space-y-3">
				<div>
					<button class="btn variant-filled" disabled={isExportingConfig} onclick={handleExportConfigData}>
						{isExportingConfig ? '...' : t('settings.exportConfigData')}
					</button>
					<span class="text-xs text-surface-500 mt-1 block">{t('settings.exportConfigDataDescription')}</span>
					{#if exportProgress !== null && isExportingConfig}
						<Progress value={exportProgress} class="mt-2">
							<Progress.Track>
								<Progress.Range />
							</Progress.Track>
						</Progress>
						<span class="text-xs text-surface-500">{exportProgress}%</span>
					{/if}
				</div>

				<div>
					<label class="btn variant-outline cursor-pointer">
						{isImportingConfig ? '...' : t('settings.importConfigData')}
						<input type="file" accept=".zip" class="sr-only" disabled={isImportingConfig} onchange={handleImportConfigData} />
					</label>
					<span class="text-xs text-surface-500 mt-1 block">{t('settings.importConfigDataDescription')}</span>
					<span class="text-xs text-warning-500 mt-1 block">{t('settings.importRecommendExport')}</span>
					<span class="text-xs text-error-500 mt-1 block">{t('settings.importConfigDataWarning')}</span>
				</div>

				{#if configImportError}
					<p class="text-xs text-error-500">{configImportError}</p>
				{/if}
			</div>

			<hr class="border-surface-200-800" />

			<div>
				<button
					class="btn variant-filled bg-error-500 hover:bg-error-600 text-white"
					disabled={isResetting}
					onclick={() => (showResetConfirm = true)}
				>
					{isResetting ? '...' : t('settings.resetConfiguration')}
				</button>
				<span class="text-xs text-surface-500 mt-1 block">{t('settings.resetConfigurationDescription')}</span>
			</div>
		</section>

		<!-- Developer -->
		<section class="card p-4 md:p-6 space-y-4">
			<h2 class="h4">{t('settings.developer')}</h2>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.locale')}</span>
				<ThemedSelect items={localeItems} value={settings.locale} onValueChange={(v) => updateSettings({ locale: v })} />
			</label>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.logLevel')}</span>
				<ThemedSelect items={logLevelItems} value={settings.logLevel} onValueChange={(v) => updateSettings({ logLevel: v as LogLevel })} />
				<span class="text-xs text-surface-500 mt-1 block">{t('settings.logLevelDescription')}</span>
			</label>
		</section>
	</div>
</div>

{#if showGameImportConfirm}
	<div
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		onclick={(e) => {
			if (e.currentTarget === e.target) showGameImportConfirm = false;
		}}
		onkeydown={(e) => e.key === 'Escape' && (showGameImportConfirm = false)}
	>
		<div class="bg-surface-100-900 border border-surface-200-800 rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
			<h3 class="text-lg font-semibold text-error-500 mb-3">{t('settings.importGameData')}</h3>
			<p class="text-sm text-surface-600-400 mb-2">{t('settings.importRecommendExport')}</p>
			<p class="text-sm text-surface-700-300 mb-5">{t('settings.importGameDataWarning')}</p>
			<div class="flex gap-2">
				<button
					class="flex-1 px-4 py-2 rounded-lg bg-surface-200-800 hover:bg-surface-300-700 text-surface-700-300 text-sm transition-colors"
					type="button"
					onclick={handleImportGameDataCancel}
				>
					{t('settings.cancel')}
				</button>
				<button
					class="flex-1 px-4 py-2 rounded-lg bg-error-500 hover:bg-error-600 text-white text-sm font-medium transition-colors"
					type="button"
					onclick={handleImportGameDataConfirm}
				>
					{t('settings.importGameData')}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showConfigImportConfirm}
	<div
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		onclick={(e) => {
			if (e.currentTarget === e.target) showConfigImportConfirm = false;
		}}
		onkeydown={(e) => e.key === 'Escape' && (showConfigImportConfirm = false)}
	>
		<div class="bg-surface-100-900 border border-surface-200-800 rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
			<h3 class="text-lg font-semibold text-error-500 mb-3">{t('settings.importConfigData')}</h3>
			<p class="text-sm text-surface-600-400 mb-2">{t('settings.importRecommendExport')}</p>
			<p class="text-sm text-surface-700-300 mb-5">{t('settings.importConfigDataWarning')}</p>
			<div class="flex gap-2">
				<button
					class="flex-1 px-4 py-2 rounded-lg bg-surface-200-800 hover:bg-surface-300-700 text-surface-700-300 text-sm transition-colors"
					type="button"
					onclick={handleImportConfigDataCancel}
				>
					{t('settings.cancel')}
				</button>
				<button
					class="flex-1 px-4 py-2 rounded-lg bg-error-500 hover:bg-error-600 text-white text-sm font-medium transition-colors"
					type="button"
					onclick={handleImportConfigDataConfirm}
				>
					{t('settings.importConfigData')}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showResetConfirm}
	<div
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		onclick={(e) => {
			if (e.currentTarget === e.target) showResetConfirm = false;
		}}
		onkeydown={(e) => e.key === 'Escape' && (showResetConfirm = false)}
	>
		<div class="bg-surface-100-900 border border-surface-200-800 rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
			<h3 class="text-lg font-semibold text-error-500 mb-3">{t('settings.resetConfiguration')}</h3>
			<p class="text-sm text-surface-700-300 mb-5">{t('settings.resetConfigurationWarning')}</p>
			<div class="flex gap-2">
				<button
					class="flex-1 px-4 py-2 rounded-lg bg-surface-200-800 hover:bg-surface-300-700 text-surface-700-300 text-sm transition-colors"
					type="button"
					onclick={() => (showResetConfirm = false)}
				>
					{t('settings.cancel')}
				</button>
				<button
					class="flex-1 px-4 py-2 rounded-lg bg-error-500 hover:bg-error-600 text-white text-sm font-medium transition-colors"
					type="button"
					onclick={handleResetConfirm}
				>
					{t('settings.resetConfiguration')}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if isImporting}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="alert" aria-live="assertive">
		<div class="text-center space-y-2">
			<div class="inline-block w-10 h-10 border-4 border-surface-200-800 border-t-primary-500 rounded-full animate-spin"></div>
			<div class="text-surface-100 animate-pulse">{t('settings.importing')}</div>
		</div>
	</div>
{/if}
