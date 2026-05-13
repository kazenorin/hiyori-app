<script lang="ts">
	import {
		settings,
		addProviderConfig,
		updateProviderConfig,
		deleteProviderConfig,
		assignRole,
		updateSettings,
		getMinorTaskAgentProviderConfig,
		type ProviderConfig,
		type Provider,
		type ApiType,
		type LogLevel,
	} from '$lib/stores/settings.svelte';
	import { fetchModels, type ModelInfo } from '$lib/ai/models';
	import { t } from '$lib/i18n';

	// Editing state
	let editingId = $state<string | null>(null);
	let isAddingNew = $state(false);

	// Form state for the provider being edited/added
	let formName = $state('');
	let formProvider = $state<Provider>('openai');
	let formApiType = $state<ApiType>('responses');
	let formBaseURL = $state('https://api.openai.com/v1');
	let formModel = $state('');
	let formApiKey = $state('');

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
</script>

<div class="flex-1 overflow-y-auto p-6">
	<div class="max-w-2xl mx-auto space-y-8">
		<h1 class="h2 font-display">{t('settings.heading')}</h1>

		<p class="text-sm text-surface-500">{t('settings.settingsAutoSaved')}</p>

		<!-- AI Providers -->
		<section class="card p-6 space-y-4">
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
						{#each settings.providers as c(c)}
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
									<select class="select mt-1" onchange={() => handleProviderChange()} bind:value={formProvider}>
										<option value="openai">{t('settings.providers.openai')}</option>
										<option value="openai-compatible">{t('settings.providers.openaiCompatible')}</option>
										<option value="ollama">{t('settings.providers.ollama')}</option>
									</select>
								</label>

								{#if formProvider === 'openai'}
									<label class="block">
										<span class="text-sm font-medium text-surface-700-300">{t('settings.apiType')}</span>
										<select class="select mt-1" bind:value={formApiType}>
											<option value="responses">{t('settings.apiTypes.responses')}</option>
											<option value="chat-completions">{t('settings.apiTypes.chatCompletions')}</option>
										</select>
										<span class="text-xs text-surface-500 mt-1 block"
											>{t('settings.apiTypeHint')}</span
										>
									</label>
								{/if}

								<label class="block">
									<span class="text-sm font-medium text-surface-700-300">{t('settings.baseUrl')}</span>
									<input class="input mt-1" type="url" placeholder="https://api.openai.com/v1" bind:value={formBaseURL} />
									<span class="text-xs text-surface-500 mt-1 block"
										>{t('settings.baseUrlHint')}</span
									>
								</label>

								<div>
									<div class="flex items-end gap-2">
										<label class="flex-1">
											<span class="text-sm font-medium text-surface-700-300">{t('settings.model')}</span>
											{#if availableModels.length > 0}
												<select class="select mt-1" bind:value={formModel}>
													{#each availableModels as model (model.id)}
														<option value={model.id}>{model.id}</option>
													{/each}
												</select>
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
									<span class="text-xs text-surface-500 mt-1 block"
										>{t('settings.apiKeyHint')}</span
									>
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
								{config.provider === 'openai' ? t('settings.providers.openai') : config.provider === 'ollama' ? t('settings.providers.ollama') : t('settings.providers.openaiCompatible')} · {config.model}
							</p>
						</div>
						<div class="flex items-center gap-1 shrink-0">
							<button class="btn preset-tonal text-xs px-2 py-1" type="button" onclick={() => handleDuplicate(config)}> {t('settings.copy')} </button>
							<button class="btn preset-tonal text-xs px-2 py-1" type="button" onclick={() => startEdit(config)}> {t('settings.edit')} </button>
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
								<select class="select mt-1" onchange={() => handleProviderChange()} bind:value={formProvider}>
									<option value="openai">{t('settings.providers.openai')}</option>
									<option value="openai-compatible">{t('settings.providers.openaiCompatible')}</option>
									<option value="ollama">{t('settings.providers.ollama')}</option>
								</select>
							</label>

							{#if formProvider === 'openai'}
								<label class="block">
									<span class="text-sm font-medium text-surface-700-300">{t('settings.apiType')}</span>
									<select class="select mt-1" bind:value={formApiType}>
										<option value="responses">{t('settings.apiTypes.responses')}</option>
										<option value="chat-completions">{t('settings.apiTypes.chatCompletions')}</option>
									</select>
									<span class="text-xs text-surface-500 mt-1 block"
										>{t('settings.apiTypeHint')}</span
									>
								</label>
							{/if}

							<label class="block">
								<span class="text-sm font-medium text-surface-700-300">{t('settings.baseUrl')}</span>
								<input class="input mt-1" type="url" placeholder="https://api.openai.com/v1" bind:value={formBaseURL} />
								<span class="text-xs text-surface-500 mt-1 block"
									>{t('settings.baseUrlHint')}</span
								>
							</label>

							<div>
								<div class="flex items-end gap-2">
									<label class="flex-1">
										<span class="text-sm font-medium text-surface-700-300">{t('settings.model')}</span>
										{#if availableModels.length > 0}
											<select class="select mt-1" bind:value={formModel}>
												{#each availableModels as model (model.id)}
													<option value={model.id}>{model.id}</option>
												{/each}
											</select>
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
								<span class="text-xs text-surface-500 mt-1 block"
									>{t('settings.apiKeyHint')}</span
								>
							</label>
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
		<section class="card p-6 space-y-4">
			<h2 class="h4">{t('settings.providerRoles')}</h2>
			<span class="text-xs text-surface-500">{t('settings.providerRolesDescription')}</span>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.mainProvider')}</span>
				<select
					class="select mt-1"
					onchange={(e) => {
						const value = (e.currentTarget as HTMLSelectElement).value;
						if (value) assignRole('main', value);
					}}
				>
					{#if settings.providers.length === 0}
						<option value="" disabled selected>{t('settings.noProvidersConfigured')}</option>
					{:else}
						{#each settings.providers as config (config.id)}
							<option value={config.id} selected={mainProviderId === config.id}>{config.name}</option>
						{/each}
					{/if}
				</select>
			</label>

				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">{t('settings.minorTaskAgent')}</span>
					<select
						class="select mt-1"
						onchange={(e) => {
							const value = (e.currentTarget as HTMLSelectElement).value;
							updateSettings({ minorTaskAgentProviderRole: value });
						}}
					>
						{#if settings.providers.length === 0}
							<option value="" disabled selected>{t('settings.noProvidersConfigured')}</option>
						{:else}
							<option value="main" selected={settings.minorTaskAgentProviderRole === 'main'}>{t('settings.mainProvider')}</option>
							{#each settings.providers as config (config.id)}
								<option value={config.id} selected={settings.minorTaskAgentProviderRole === config.id}>{config.name}</option>
							{/each}
						{/if}
					</select>
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
		<section class="card p-6 space-y-4">
			<h2 class="h4">{t('settings.memory')}</h2>
			<span class="text-xs text-surface-500">{t('settings.enableMemoryDescription')}</span>

			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					class="checkbox"
					checked={settings.memoryEnabled}
					onchange={(e) => updateSettings({ memoryEnabled: (e.currentTarget as HTMLInputElement).checked })}
				/>
				<span class="text-sm font-medium text-surface-700-300">{t('settings.enableMemory')}</span>
			</label>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.memoryProvider')}</span>
				<select
					class="select mt-1"
					disabled={!settings.memoryEnabled}
					onchange={(e) => {
						const value = (e.currentTarget as HTMLSelectElement).value;
						updateSettings({ memoryProviderRole: value });
					}}
				>
					{#if settings.providers.length === 0}
						<option value="" disabled selected>{t('settings.noProvidersConfigured')}</option>
					{:else}
						<option value="main" selected={settings.memoryProviderRole === 'main'}>{t('settings.mainProvider')}</option>
						{#each settings.providers as config (config.id)}
							<option value={config.id} selected={settings.memoryProviderRole === config.id}>{config.name}</option>
						{/each}
					{/if}
				</select>
				<span class="text-xs text-surface-500 mt-1 block">{t('settings.memoryProviderDescription')}</span>
			</label>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.embeddingProvider')}</span>
				<select
					class="select mt-1"
					disabled={!settings.memoryEnabled}
					onchange={(e) => {
						const value = (e.currentTarget as HTMLSelectElement).value;
						updateSettings({ embeddingProviderRole: value });
					}}
				>
					{#if settings.providers.length === 0}
						<option value="" disabled selected>{t('settings.noProvidersConfigured')}</option>
					{:else}
						<option value="main" selected={settings.embeddingProviderRole === 'main'}>{t('settings.mainProvider')}</option>
						{#each settings.providers as config (config.id)}
							<option value={config.id} selected={settings.embeddingProviderRole === config.id}>{config.name}</option>
						{/each}
					{/if}
				</select>
				<span class="text-xs text-surface-500 mt-1 block">{t('settings.embeddingProviderDescription')}</span>
			</label>
		</section>

		<!-- Pipeline Roles -->
		<section class="card p-6 space-y-4">
			<h2 class="h4">{t('settings.pipelineRoles')}</h2>
			<span class="text-xs text-surface-500">{t('settings.pipelineRolesDescription')}</span>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.plotPlanner')}</span>
				<select
					class="select mt-1"
					onchange={(e) => {
						const value = (e.currentTarget as HTMLSelectElement).value;
						updateSettings({ plotPlannerProviderRole: value });
					}}
				>
					{#if settings.providers.length === 0}
						<option value="" disabled selected>{t('settings.noProvidersConfigured')}</option>
					{:else}
						<option value="main" selected={settings.plotPlannerProviderRole === 'main'}>{t('settings.mainProvider')}</option>
						{#each settings.providers as config (config.id)}
							<option value={config.id} selected={settings.plotPlannerProviderRole === config.id}>{config.name}</option>
						{/each}
					{/if}
				</select>
				<span class="text-xs text-surface-500 mt-1 block">{t('settings.plotPlannerDescription')}</span>
			</label>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.writer')}</span>
				<select
					class="select mt-1"
					onchange={(e) => {
						const value = (e.currentTarget as HTMLSelectElement).value;
						updateSettings({ writerProviderRole: value });
					}}
				>
					{#if settings.providers.length === 0}
						<option value="" disabled selected>{t('settings.noProvidersConfigured')}</option>
					{:else}
						<option value="main" selected={settings.writerProviderRole === 'main'}>{t('settings.mainProvider')}</option>
						{#each settings.providers as config (config.id)}
							<option value={config.id} selected={settings.writerProviderRole === config.id}>{config.name}</option>
						{/each}
					{/if}
				</select>
				<span class="text-xs text-surface-500 mt-1 block">{t('settings.writerDescription')}</span>
			</label>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.reviewer')}</span>
				<select
					class="select mt-1"
					onchange={(e) => {
						const value = (e.currentTarget as HTMLSelectElement).value;
						updateSettings({ reviewerProviderRole: value });
					}}
				>
					{#if settings.providers.length === 0}
						<option value="" disabled selected>{t('settings.noProvidersConfigured')}</option>
					{:else}
						<option value="main" selected={settings.reviewerProviderRole === 'main'}>{t('settings.mainProvider')}</option>
						{#each settings.providers as config (config.id)}
							<option value={config.id} selected={settings.reviewerProviderRole === config.id}>{config.name}</option>
						{/each}
					{/if}
				</select>
				<span class="text-xs text-surface-500 mt-1 block">{t('settings.reviewerDescription')}</span>
			</label>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.editor')}</span>
				<select
					class="select mt-1"
					onchange={(e) => {
						const value = (e.currentTarget as HTMLSelectElement).value;
						updateSettings({ editorProviderRole: value });
					}}
				>
					{#if settings.providers.length === 0}
						<option value="" disabled selected>{t('settings.noProvidersConfigured')}</option>
					{:else}
						<option value="main" selected={settings.editorProviderRole === 'main'}>{t('settings.mainProvider')}</option>
						{#each settings.providers as config (config.id)}
							<option value={config.id} selected={settings.editorProviderRole === config.id}>{config.name}</option>
						{/each}
					{/if}
				</select>
				<span class="text-xs text-surface-500 mt-1 block">{t('settings.editorDescription')}</span>
			</label>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.gameMaster')}</span>
				<select
					class="select mt-1"
					onchange={(e) => {
						const value = (e.currentTarget as HTMLSelectElement).value;
						updateSettings({ gameMasterProviderRole: value });
					}}
				>
					{#if settings.providers.length === 0}
						<option value="" disabled selected>{t('settings.noProvidersConfigured')}</option>
					{:else}
						<option value="main" selected={settings.gameMasterProviderRole === 'main'}>{t('settings.mainProvider')}</option>
						{#each settings.providers as config (config.id)}
							<option value={config.id} selected={settings.gameMasterProviderRole === config.id}>{config.name}</option>
						{/each}
					{/if}
				</select>
				<span class="text-xs text-surface-500 mt-1 block">{t('settings.gameMasterDescription')}</span>
			</label>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.summarizer')}</span>
				<select
					class="select mt-1"
					onchange={(e) => {
						const value = (e.currentTarget as HTMLSelectElement).value;
						updateSettings({ summarizerProviderRole: value });
					}}
				>
					{#if settings.providers.length === 0}
						<option value="" disabled selected>{t('settings.noProvidersConfigured')}</option>
					{:else}
						<option value="main" selected={settings.summarizerProviderRole === 'main'}>{t('settings.mainProvider')}</option>
						{#each settings.providers as config (config.id)}
							<option value={config.id} selected={settings.summarizerProviderRole === config.id}>{config.name}</option>
						{/each}
					{/if}
				</select>
				<span class="text-xs text-surface-500 mt-1 block">{t('settings.summarizerDescription')}</span>
			</label>
		</section>

		<!-- Narrative -->
		<section class="card p-6 space-y-4">
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
				<span class="text-xs text-surface-500 mt-1 block"
					>{t('settings.targetWordCountDescription')}</span
				>
			</label>
		</section>

		<!-- Developer -->
		<section class="card p-6 space-y-4">
			<h2 class="h4">{t('settings.developer')}</h2>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.locale')}</span>
				<select class="select mt-1" onchange={(e) => updateSettings({ locale: (e.currentTarget as HTMLSelectElement).value })}>
					<option value="en" selected={settings.locale === 'en'}>English</option>
				</select>
			</label>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('settings.logLevel')}</span>
				<select
					class="select mt-1"
					onchange={(e) => updateSettings({ logLevel: (e.currentTarget as HTMLSelectElement).value as LogLevel })}
				>
					<option value="error" selected={settings.logLevel === 'error'}>{t('settings.logLevels.error')}</option>
					<option value="warn" selected={settings.logLevel === 'warn'}>{t('settings.logLevels.warn')}</option>
					<option value="info" selected={settings.logLevel === 'info'}>{t('settings.logLevels.info')}</option>
					<option value="debug" selected={settings.logLevel === 'debug'}>{t('settings.logLevels.debug')}</option>
				</select>
				<span class="text-xs text-surface-500 mt-1 block"
					>{t('settings.logLevelDescription')}</span
				>
			</label>
		</section>
	</div>
</div>
