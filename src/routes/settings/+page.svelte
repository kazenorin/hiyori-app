<script lang="ts">
	import { getSettings, updateSettings } from '$lib/stores/settings.svelte';
	import { fetchModels, type ModelInfo } from '$lib/ai/models';
	import type { Provider, ApiType, LogLevel } from '$lib/stores/settings.svelte';

	const settings = getSettings();
	let availableModels = $state<ModelInfo[]>([]);
	let isLoadingModels = $state(false);
	let modelsError = $state<string | null>(null);

	function handleProviderChange(e: Event) {
		const value = (e.currentTarget as HTMLSelectElement).value as Provider;
		updateSettings({ provider: value });
	}

	function handleApiTypeChange(e: Event) {
		const value = (e.currentTarget as HTMLSelectElement).value as ApiType;
		updateSettings({ apiType: value });
	}

	function handleBaseURLChange(e: Event) {
		updateSettings({ baseURL: (e.currentTarget as HTMLInputElement).value });
	}

	function handleModelSelect(e: Event) {
		const value = (e.currentTarget as HTMLSelectElement).value;
		updateSettings({ model: value });
	}

	function handleModelInput(e: Event) {
		updateSettings({ model: (e.currentTarget as HTMLInputElement).value });
	}

	function handleApiKeyChange(e: Event) {
		updateSettings({ apiKey: (e.currentTarget as HTMLInputElement).value });
	}

	async function handleFetchModels() {
		isLoadingModels = true;
		modelsError = null;
		try {
			availableModels = await fetchModels(getSettings());
		} catch (err: unknown) {
			modelsError = err instanceof Error ? err.message : 'Failed to fetch models';
			availableModels = [];
		} finally {
			isLoadingModels = false;
		}
	}
</script>

<div class="flex-1 overflow-y-auto p-6">
	<div class="max-w-2xl mx-auto space-y-8">
		<h1 class="h2 font-display">Settings</h1>

		<p class="text-sm text-surface-500">Settings are saved automatically.</p>

		<!-- Model Configuration -->
		<section class="card p-6 space-y-4">
			<h2 class="h4">Model</h2>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">API Provider</span>
				<select class="select mt-1" onchange={handleProviderChange}>
					<option value="openai" selected={settings.provider === 'openai'}>OpenAI</option>
					<option value="openai-compatible" selected={settings.provider === 'openai-compatible'}
						>OpenAI-Compatible</option
					>
				</select>
			</label>

			{#if settings.provider === 'openai'}
				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">API Type</span>
					<select class="select mt-1" onchange={handleApiTypeChange}>
						<option value="responses" selected={settings.apiType === 'responses'}
							>Responses</option
						>
						<option value="chat-completions" selected={settings.apiType === 'chat-completions'}
							>Chat Completions</option
						>
					</select>
					<span class="text-xs text-surface-500 mt-1 block"
						>Responses uses the OpenAI Responses API. Chat Completions uses /chat/completions.</span
					>
				</label>
			{/if}

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">Base URL</span>
				<input
					class="input mt-1"
					type="url"
					placeholder="https://api.openai.com/v1"
					value={settings.baseURL}
					oninput={handleBaseURLChange}
				/>
				<span class="text-xs text-surface-500 mt-1 block"
					>For local providers: http://localhost:11434/v1 (Ollama), http://localhost:1234/v1 (LM
					Studio)</span
				>
			</label>

			<div>
				<div class="flex items-end gap-2">
					<label class="flex-1">
						<span class="text-sm font-medium text-surface-700-300">Model</span>
						{#if availableModels.length > 0}
							<select class="select mt-1" onchange={handleModelSelect}>
								{#each availableModels as model (model.id)}
									<option value={model.id} selected={settings.model === model.id}
										>{model.id}</option
									>
								{/each}
							</select>
						{:else}
							<input
								class="input mt-1"
								type="text"
								placeholder="gpt-4o"
								value={settings.model}
								oninput={handleModelInput}
							/>
						{/if}
					</label>
					<button
						class="btn preset-tonal shrink-0"
						type="button"
						onclick={handleFetchModels}
						disabled={isLoadingModels}
					>
						{isLoadingModels ? 'Loading...' : 'Fetch Models'}
					</button>
				</div>
				{#if availableModels.length > 0}
					<label class="block mt-2">
						<span class="text-xs text-surface-500">Or type manually</span>
						<input
							class="input mt-1"
							type="text"
							placeholder="gpt-4o"
							value={settings.model}
							oninput={handleModelInput}
						/>
					</label>
				{/if}
				{#if modelsError}
					<p class="text-xs text-error-700-300 mt-1">{modelsError}</p>
				{/if}
			</div>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">API Key</span>
				<input
					class="input mt-1"
					type="password"
					placeholder="sk-..."
					value={settings.apiKey}
					oninput={handleApiKeyChange}
				/>
			</label>
		</section>

		<!-- Developer -->
		<section class="card p-6 space-y-4">
			<h2 class="h4">Developer</h2>

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">Log Level</span>
				<select
					class="select mt-1"
					onchange={(e) =>
						updateSettings({ logLevel: (e.currentTarget as HTMLSelectElement).value as LogLevel })}
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
