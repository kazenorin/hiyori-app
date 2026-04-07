<script lang="ts">
	import { getSettings, updateSettings } from '$lib/stores/settings.svelte';
	import type { Provider, ApiType } from '$lib/stores/settings.svelte';

	const settings = getSettings();

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

	function handleModelChange(e: Event) {
		updateSettings({ model: (e.currentTarget as HTMLInputElement).value });
	}

	function handleApiKeyChange(e: Event) {
		updateSettings({ apiKey: (e.currentTarget as HTMLInputElement).value });
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
				<select class="input mt-1" onchange={handleProviderChange}>
					<option value="openai" selected={settings.provider === 'openai'}>OpenAI</option>
					<option value="openai-compatible" selected={settings.provider === 'openai-compatible'}
						>OpenAI-Compatible</option
					>
				</select>
			</label>

			{#if settings.provider === 'openai-compatible'}
				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">API Type</span>
					<select class="input mt-1" onchange={handleApiTypeChange}>
						<option value="chat-completions" selected={settings.apiType === 'chat-completions'}
							>Chat Completions</option
						>
						<option value="responses" selected={settings.apiType === 'responses'}>Responses</option>
					</select>
					<span class="text-xs text-surface-500 mt-1 block"
						>Chat Completions uses /chat/completions endpoint. Most local providers use this.</span
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

			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">Model</span>
				<input
					class="input mt-1"
					type="text"
					placeholder="gpt-4o"
					value={settings.model}
					oninput={handleModelChange}
				/>
			</label>

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
	</div>
</div>
