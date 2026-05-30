<script lang="ts">
	import {
		settings,
		addProviderConfig,
		updateProviderConfig,
		deleteProviderConfig,
		assignRole,
		updateSettings,
		getMinorTaskAgentProviderConfig,
		isMemoryAvailable,
		type ProviderConfig,
		type Provider,
		type ApiType,
		type LogLevel,
	} from '$lib/stores/settings.svelte';
	import { fetchModels, type ModelInfo } from '$lib/ai/models';
	import { t } from '$lib/i18n';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import { exportDatabase, importDatabase, downloadExport, readFileAsUint8Array, isBinaryFormat } from '$lib/db/data-portability';
	import { isTauriSync } from '$lib/runtime';

	// Editing state
	let editingId = $state<string | null>(null);
	let isAddingNew = $state(false);

	// Data import/export state
	let isExporting = $state(false);
	let isImporting = $state(false);
	let importError = $state<string | null>(null);

	// Form state for the provider being edited/added
	let formName = $state('');
	let formProvider = $state<Provider>('openai');
	let formApiType = $state<ApiType>('responses');
	let formBaseURL = $state('https://api.openai.com/v1');
	let formModel = $state('');
	let formApiKey = $state('');
	let formCorsBypassEnabled = $state(false);
	let formWispProxyUrl = $state('');

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
		formWispProxyUrl = '';
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
		if (formProvider === 'openai') {
			formBaseURL = 'https://api.openai.com/v1';
		} else if (formProvider === 'ollama') {
			formBaseURL = 'https://ollama.com';
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
			availableModels = await fetchModels({ baseURL: formBaseURL, apiKey: formApiKey, provider: formProvider });
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
		{ label: t('settings.providers.openai'), value: 'openai' },
		{ label: t('settings.providers.openaiCompatible'), value: 'openai-compatible' },
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
										<input class="input mt-1" type="url" placeholder="wss://example.com/ws/" bind:value={formWispProxyUrl} />
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
					disabled={!isMemoryAvailable()}
				/>
				<span class="text-sm font-medium text-surface-700-300">{t('settings.enableMemory')}</span>
			</label>
			{#if !isMemoryAvailable()}
				<span class="text-xs text-warning-500">{t('settings.memoryUnavailableNoVec')}</span>
			{/if}

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
						class="mt-1"
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

			<div class="space-y-3">
				<div>
					<button
						class="btn variant-filled"
						disabled={isExporting}
						onclick={async () => {
							isExporting = true;
							importError = null;
							try {
								const data = await exportDatabase();
								const ext = isBinaryFormat() ? 'db' : 'json';
								const ts = new Date().toISOString().slice(0, 10);
								downloadExport(data, `byoa-backup-${ts}.${ext}`);
							} catch (err) {
								importError = t('settings.exportFailed', { error: err instanceof Error ? err.message : String(err) });
							} finally {
								isExporting = false;
							}
						}}
					>
						{isExporting ? '...' : t('settings.exportDatabase')}
					</button>
					<span class="text-xs text-surface-500 mt-1 block">{t('settings.exportDatabaseDescription')}</span>
				</div>

				<div>
					<label class="btn variant-outline cursor-pointer">
						{isImporting ? '...' : t('settings.importDatabase')}
						<input
							type="file"
							accept=".db,.json"
							class="sr-only"
							disabled={isImporting}
							onchange={async (e) => {
								const file = (e.currentTarget as HTMLInputElement).files?.[0];
								if (!file) return;
								isImporting = true;
								importError = null;
								try {
									const data = await readFileAsUint8Array(file);
									await importDatabase(data);
									window.location.reload();
								} catch (err) {
									importError = t('settings.importFailed', { error: err instanceof Error ? err.message : String(err) });
									isImporting = false;
								}
							}}
						/>
					</label>
					<span class="text-xs text-surface-500 mt-1 block">{t('settings.importDatabaseDescription')}</span>
					<span class="text-xs text-warning-500 mt-1 block">{t('settings.importWarning')}</span>
				</div>

				{#if importError}
					<p class="text-xs text-error-500">{importError}</p>
				{/if}
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
