<script lang="ts">
	import {
		settings,
		addProviderConfig,
		updateProviderConfig,
		deleteProviderConfig,
		assignRole,
		updateSettings,
		type ProviderConfig,
		type Provider,
		type ApiType,
		type LogLevel,
	} from '$lib/stores/settings.svelte';
	import { fetchModels, type ModelInfo } from '$lib/ai/models';

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
			name: formName || 'Untitled Provider',
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
			name: config.name + ' (copy)',
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
			modelsError = err instanceof Error ? err.message : 'Failed to fetch models';
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
		<h1 class="h2 font-display">Settings</h1>

		<p class="text-sm text-surface-500">Settings are saved automatically.</p>

		<!-- AI Providers -->
		<section class="card p-6 space-y-4">
			<div class="flex items-center justify-between">
				<h2 class="h4">AI Providers</h2>
				<button class="btn preset-tonal" type="button" onclick={startAdd}> + Add Provider </button>
			</div>

			{#if settings.providers.length === 0 && !isAddingNew}
				<p class="text-sm text-surface-500 py-2">No providers configured. Add one to get started.</p>
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
									Editing{#if isMain}
										(main provider){/if}
								</p>
							{/if}
						{/each}
						<details open>
							<summary class="text-sm font-medium cursor-pointer">{formName || 'Untitled'}</summary>
							<div class="mt-3 space-y-3">
								<label class="block">
									<span class="text-sm font-medium text-surface-700-300">Name</span>
									<input class="input mt-1" type="text" placeholder="e.g. OpenAI GPT-4o" bind:value={formName} />
								</label>

								<label class="block">
									<span class="text-sm font-medium text-surface-700-300">API Provider</span>
									<select class="select mt-1" onchange={() => handleProviderChange()} bind:value={formProvider}>
										<option value="openai">OpenAI</option>
										<option value="openai-compatible">OpenAI-Compatible</option>
										<option value="ollama">Ollama</option>
									</select>
								</label>

								{#if formProvider === 'openai'}
									<label class="block">
										<span class="text-sm font-medium text-surface-700-300">API Type</span>
										<select class="select mt-1" bind:value={formApiType}>
											<option value="responses">Responses</option>
											<option value="chat-completions">Chat Completions</option>
										</select>
										<span class="text-xs text-surface-500 mt-1 block"
											>Responses uses the OpenAI Responses API. Chat Completions uses /chat/completions.</span
										>
									</label>
								{/if}

								<label class="block">
									<span class="text-sm font-medium text-surface-700-300">Base URL</span>
									<input class="input mt-1" type="url" placeholder="https://api.openai.com/v1" bind:value={formBaseURL} />
									<span class="text-xs text-surface-500 mt-1 block"
										>Local: http://localhost:11434/v1 (Ollama), http://localhost:1234/v1 (LM Studio)</span
									>
								</label>

								<div>
									<div class="flex items-end gap-2">
										<label class="flex-1">
											<span class="text-sm font-medium text-surface-700-300">Model</span>
											{#if availableModels.length > 0}
												<select class="select mt-1" bind:value={formModel}>
													{#each availableModels as model (model.id)}
														<option value={model.id}>{model.id}</option>
													{/each}
												</select>
											{:else}
												<input class="input mt-1" type="text" placeholder="gpt-4o" bind:value={formModel} />
											{/if}
										</label>
										<button class="btn preset-tonal shrink-0" type="button" onclick={handleFetchModels} disabled={isLoadingModels}>
											{isLoadingModels ? 'Loading...' : 'Fetch Models'}
										</button>
									</div>
									{#if availableModels.length > 0}
										<label class="block mt-2">
											<span class="text-xs text-surface-500">Or type manually</span>
											<input class="input mt-1" type="text" placeholder="gpt-4o" bind:value={formModel} />
										</label>
									{/if}
									{#if modelsError}
										<p class="text-xs text-error-700-300 mt-1">{modelsError}</p>
									{/if}
								</div>

								<label class="block">
									<span class="text-sm font-medium text-surface-700-300">API Key</span>
									<input class="input mt-1" type="password" placeholder="sk-..." bind:value={formApiKey} />
									<span class="text-xs text-surface-500 mt-1 block"
										>Required for cloud models/providers</span
									>
								</label>
							</div>
						</details>
						<div class="flex gap-2">
							<button class="btn preset-filled" type="button" onclick={handleSaveEdit}> Save </button>
							<button class="btn preset-tonal" type="button" onclick={cancelEdit}> Cancel </button>
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
								{config.provider === 'openai' ? 'OpenAI' : config.provider === 'ollama' ? 'Ollama' : 'OpenAI-Compatible'} · {config.model}
							</p>
						</div>
						<div class="flex items-center gap-1 shrink-0">
							<button class="btn preset-tonal text-xs px-2 py-1" type="button" onclick={() => handleDuplicate(config)}> Copy </button>
							<button class="btn preset-tonal text-xs px-2 py-1" type="button" onclick={() => startEdit(config)}> Edit </button>
							{#if mainProviderId !== config.id}
								<button class="btn preset-tonal text-xs px-2 py-1 text-error-700-300" type="button" onclick={() => handleDelete(config.id)}>
									Delete
								</button>
							{/if}
						</div>
					</div>
				{/if}
			{/each}

			<!-- Add New Provider Form -->
			{#if isAddingNew}
				<div class="card p-4 space-y-3 border border-primary-500-300">
					<p class="text-xs text-surface-500">New provider</p>
					<details open>
						<summary class="text-sm font-medium cursor-pointer">{formName || 'New Provider'}</summary>
						<div class="mt-3 space-y-3">
							<label class="block">
								<span class="text-sm font-medium text-surface-700-300">Name</span>
								<input class="input mt-1" type="text" placeholder="e.g. OpenAI GPT-4o" bind:value={formName} />
							</label>

							<label class="block">
								<span class="text-sm font-medium text-surface-700-300">API Provider</span>
								<select class="select mt-1" onchange={() => handleProviderChange()} bind:value={formProvider}>
									<option value="openai">OpenAI</option>
									<option value="openai-compatible">OpenAI-Compatible</option>
									<option value="ollama">Ollama</option>
								</select>
							</label>

							{#if formProvider === 'openai'}
								<label class="block">
									<span class="text-sm font-medium text-surface-700-300">API Type</span>
									<select class="select mt-1" bind:value={formApiType}>
										<option value="responses">Responses</option>
										<option value="chat-completions">Chat Completions</option>
									</select>
									<span class="text-xs text-surface-500 mt-1 block"
										>Responses uses the OpenAI Responses API. Chat Completions uses /chat/completions.</span
									>
								</label>
							{/if}

							<label class="block">
								<span class="text-sm font-medium text-surface-700-300">Base URL</span>
								<input class="input mt-1" type="url" placeholder="https://api.openai.com/v1" bind:value={formBaseURL} />
								<span class="text-xs text-surface-500 mt-1 block"
									>Local: http://localhost:11434/v1 (Local Ollama), http://localhost:1234/v1 (LM Studio)</span
								>
							</label>

							<div>
								<div class="flex items-end gap-2">
									<label class="flex-1">
										<span class="text-sm font-medium text-surface-700-300">Model</span>
										{#if availableModels.length > 0}
											<select class="select mt-1" bind:value={formModel}>
												{#each availableModels as model (model.id)}
													<option value={model.id}>{model.id}</option>
												{/each}
											</select>
										{:else}
											<input class="input mt-1" type="text" placeholder="gpt-4o" bind:value={formModel} />
										{/if}
									</label>
									<button class="btn preset-tonal shrink-0" type="button" onclick={handleFetchModels} disabled={isLoadingModels}>
										{isLoadingModels ? 'Loading...' : 'Fetch Models'}
									</button>
								</div>
								{#if availableModels.length > 0}
									<label class="block mt-2">
										<span class="text-xs text-surface-500">Or type manually</span>
										<input class="input mt-1" type="text" placeholder="gpt-4o" bind:value={formModel} />
									</label>
								{/if}
								{#if modelsError}
									<p class="text-xs text-error-700-300 mt-1">{modelsError}</p>
								{/if}
							</div>

							<label class="block">
								<span class="text-sm font-medium text-surface-700-300">API Key</span>
								<input class="input mt-1" type="password" placeholder="sk-..." bind:value={formApiKey} />
								<span class="text-xs text-surface-500 mt-1 block"
									>Required for cloud models/providers</span
								>
							</label>
						</div>
					</details>
					<div class="flex gap-2">
						<button class="btn preset-filled" type="button" onclick={handleSaveNew}> Add Provider </button>
						<button class="btn preset-tonal" type="button" onclick={cancelEdit}> Cancel </button>
					</div>
				</div>
			{/if}
		</section>

		<!-- Provider Roles -->
		<section class="card p-6 space-y-4">
			<h2 class="h4">Provider Roles</h2>
			<span class="text-xs text-surface-500">Assign providers to functions. The main provider is used for chat and world building.</span>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">Main Provider</span>
				<select
					class="select mt-1"
					onchange={(e) => {
						const value = (e.currentTarget as HTMLSelectElement).value;
						if (value) assignRole('main', value);
					}}
				>
					{#if settings.providers.length === 0}
						<option value="" disabled selected>No providers configured</option>
					{:else}
						{#each settings.providers as config (config.id)}
							<option value={config.id} selected={mainProviderId === config.id}>{config.name}</option>
						{/each}
					{/if}
				</select>
			</label>
		</section>

		<!-- Memory -->
		<section class="card p-6 space-y-4">
			<h2 class="h4">Memory</h2>
			<span class="text-xs text-surface-500">Automatically save and recall context from past conversations.</span>

			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					class="checkbox"
					checked={settings.memoryEnabled}
					onchange={(e) => updateSettings({ memoryEnabled: (e.currentTarget as HTMLInputElement).checked })}
				/>
				<span class="text-sm font-medium text-surface-700-300">Enable memory</span>
			</label>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">Memory Provider</span>
				<select
					class="select mt-1"
					disabled={!settings.memoryEnabled}
					onchange={(e) => {
						const value = (e.currentTarget as HTMLSelectElement).value;
						updateSettings({ memoryProviderRole: value });
					}}
				>
					{#if settings.providers.length === 0}
						<option value="" disabled selected>No providers configured</option>
					{:else}
						<option value="main" selected={settings.memoryProviderRole === 'main'}>Main Provider</option>
						{#each settings.providers as config (config.id)}
							<option value={config.id} selected={settings.memoryProviderRole === config.id}>{config.name}</option>
						{/each}
					{/if}
				</select>
				<span class="text-xs text-surface-500 mt-1 block">The LLM provider used to extract memories from chat responses.</span>
			</label>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">Embedding Provider</span>
				<select
					class="select mt-1"
					disabled={!settings.memoryEnabled}
					onchange={(e) => {
						const value = (e.currentTarget as HTMLSelectElement).value;
						updateSettings({ embeddingProviderRole: value });
					}}
				>
					{#if settings.providers.length === 0}
						<option value="" disabled selected>No providers configured</option>
					{:else}
						<option value="main" selected={settings.embeddingProviderRole === 'main'}>Main Provider</option>
						{#each settings.providers as config (config.id)}
							<option value={config.id} selected={settings.embeddingProviderRole === config.id}>{config.name}</option>
						{/each}
					{/if}
				</select>
				<span class="text-xs text-surface-500 mt-1 block">The provider used to generate embeddings for memory search.</span>
			</label>
		</section>

		<!-- Review & Quality -->
		<section class="card p-6 space-y-4">
			<h2 class="h4">Review & Quality</h2>
			<span class="text-xs text-surface-500">Run a QA reviewer on GM outputs before delivering to the player.</span>

			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					class="checkbox"
					checked={settings.reviewerEnabled}
					onchange={(e) => updateSettings({ reviewerEnabled: (e.currentTarget as HTMLInputElement).checked })}
				/>
				<span class="text-sm font-medium text-surface-700-300">Enable review loop</span>
			</label>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">Reviewer Provider</span>
				<select
					class="select mt-1"
					disabled={!settings.reviewerEnabled}
					onchange={(e) => {
						const value = (e.currentTarget as HTMLSelectElement).value;
						updateSettings({ reviewerProviderRole: value });
					}}
				>
					{#if settings.providers.length === 0}
						<option value="" disabled selected>No providers configured</option>
					{:else}
						<option value="main" selected={settings.reviewerProviderRole === 'main'}>Main Provider</option>
						{#each settings.providers as config (config.id)}
							<option value={config.id} selected={settings.reviewerProviderRole === config.id}>{config.name}</option>
						{/each}
					{/if}
				</select>
				<span class="text-xs text-surface-500 mt-1 block">The LLM provider used to review and revise GM outputs.</span>
			</label>
		</section>

		<!-- Developer -->
		<section class="card p-6 space-y-4">
			<h2 class="h4">Developer</h2>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">Log Level</span>
				<select
					class="select mt-1"
					onchange={(e) => updateSettings({ logLevel: (e.currentTarget as HTMLSelectElement).value as LogLevel })}
				>
					<option value="error" selected={settings.logLevel === 'error'}>Error</option>
					<option value="warn" selected={settings.logLevel === 'warn'}>Warn</option>
					<option value="info" selected={settings.logLevel === 'info'}>Info (default)</option>
					<option value="debug" selected={settings.logLevel === 'debug'}>Debug</option>
				</select>
				<span class="text-xs text-surface-500 mt-1 block"
					>Debug logs include full AI chat context. Logs are written to the app log directory.</span
				>
			</label>
		</section>
	</div>
</div>
