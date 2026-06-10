<script lang="ts">
	import { t } from '$lib/i18n';
	import { fetchModels, type ModelInfo } from '$lib/ai/models';
	import { isTauriSync } from '$lib/runtime';
	import type { ApiType, Provider, ProviderConfig } from '$lib/stores/settings.svelte';
	import type { CallSettings } from 'ai';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import TextField from '$lib/components/ui/TextField.svelte';
	import Button from '$lib/components/ui/Button.svelte';

	interface Props {
		mode: 'add' | 'edit';
		config?: ProviderConfig;
		isMainProvider?: boolean;
		onsave: (data: Omit<ProviderConfig, 'id'>) => void;
		oncancel: () => void;
	}

	let { mode, config, isMainProvider = false, onsave, oncancel }: Props = $props();

	// Snapshot the initial values once; the edit form should not reactively track prop changes
	// svelte-ignore state_referenced_locally
	let formName = $state(config?.name ?? '');
	// svelte-ignore state_referenced_locally
	let formProvider = $state<Provider>(config?.provider ?? 'openai-compatible');
	// svelte-ignore state_referenced_locally
	let formApiType = $state<ApiType>(config?.apiType ?? 'chat-completions');
	// svelte-ignore state_referenced_locally
	let formBaseURL = $state(config?.baseURL ?? 'http://localhost:1234/v1');
	// svelte-ignore state_referenced_locally
	let formModel = $state(config?.model ?? '');
	// svelte-ignore state_referenced_locally
	let formApiKey = $state(config?.apiKey ?? '');
	// svelte-ignore state_referenced_locally
	let formCorsBypassEnabled = $state(config?.corsBypassEnabled ?? false);
	// svelte-ignore state_referenced_locally
	let formWispProxyUrl = $state(config?.wispProxyUrl ?? 'ws://localhost:6001');

	// svelte-ignore state_referenced_locally
	let formTemperatureEnabled = $state(config?.callSettings?.temperature !== undefined);
	// svelte-ignore state_referenced_locally
	let formTemperature = $state(config?.callSettings?.temperature ?? 0.7);
	// svelte-ignore state_referenced_locally
	let formTopPEnabled = $state(config?.callSettings?.topP !== undefined);
	// svelte-ignore state_referenced_locally
	let formTopP = $state(config?.callSettings?.topP ?? 1);
	// svelte-ignore state_referenced_locally
	let formTopKEnabled = $state(config?.callSettings?.topK !== undefined);
	// svelte-ignore state_referenced_locally
	let formTopK = $state(config?.callSettings?.topK ?? 0);
	// svelte-ignore state_referenced_locally
	let formPresencePenaltyEnabled = $state(config?.callSettings?.presencePenalty !== undefined);
	// svelte-ignore state_referenced_locally
	let formPresencePenalty = $state(config?.callSettings?.presencePenalty ?? 0);
	// svelte-ignore state_referenced_locally
	let formFrequencyPenaltyEnabled = $state(config?.callSettings?.frequencyPenalty !== undefined);
	// svelte-ignore state_referenced_locally
	let formFrequencyPenalty = $state(config?.callSettings?.frequencyPenalty ?? 0);

	let baseUrlHint = $derived(
		formProvider === 'openai'
			? t('settings.baseUrlHint.openai')
			: formProvider === 'ollama'
				? t('settings.baseUrlHint.ollama')
				: t('settings.baseUrlHint.openaiCompatible')
	);

	let availableModels = $state<ModelInfo[]>([]);
	let isLoadingModels = $state(false);
	let modelsError = $state<string | null>(null);

	const providerItems: { label: string; value: string }[] = [
		{ label: t('settings.providers.openaiCompatible'), value: 'openai-compatible' },
		{ label: t('settings.providers.openai'), value: 'openai' },
		{ label: t('settings.providers.ollama'), value: 'ollama' },
	];

	const apiTypeItems: { label: string; value: string }[] = [
		{ label: t('settings.apiTypes.responses'), value: 'responses' },
		{ label: t('settings.apiTypes.chatCompletions'), value: 'chat-completions' },
	];

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

	function buildCallSettings(): CallSettings | undefined {
		const cs: CallSettings = {};
		if (formTemperatureEnabled) cs.temperature = formTemperature;
		if (formTopPEnabled) cs.topP = formTopP;
		if (formTopKEnabled) cs.topK = formTopK;
		if (formPresencePenaltyEnabled) cs.presencePenalty = formPresencePenalty;
		if (formFrequencyPenaltyEnabled) cs.frequencyPenalty = formFrequencyPenalty;
		return Object.keys(cs).length > 0 ? cs : undefined;
	}

	function handleSave() {
		onsave({
			name: formName || t('settings.untitledProvider'),
			provider: formProvider,
			apiType: formApiType,
			baseURL: formBaseURL,
			model: formModel,
			apiKey: formApiKey,
			corsBypassEnabled: formCorsBypassEnabled,
			wispProxyUrl: formWispProxyUrl,
			callSettings: buildCallSettings(),
		});
	}
</script>

<div class="card p-3 md:p-4 space-y-3 border border-primary-500-300">
	<p class="text-xs text-surface-500">
		{#if mode === 'edit'}
			{t('settings.editing')}{#if isMainProvider}{t('settings.mainProviderTag')}{/if}
		{:else}
			{t('settings.newProvider')}
		{/if}
	</p>
	<details open>
		<summary class="text-sm font-medium cursor-pointer">
			{formName || (mode === 'edit' ? t('settings.untitled') : t('settings.newProviderTitle'))}
		</summary>
		<div class="mt-3 space-y-3">
			<TextField label={t('settings.name')} type="text" placeholder={t('settings.namePlaceholder')} bind:value={formName} />

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

			<TextField
				label={t('settings.baseUrl')}
				type="url"
				placeholder="https://api.openai.com/v1"
				bind:value={formBaseURL}
				hint={baseUrlHint}
			/>

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
					<button class="btn preset-tonal shrink-0 min-h-11" type="button" onclick={handleFetchModels} disabled={isLoadingModels}>
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

			<TextField
				label={t('settings.apiKey')}
				type="password"
				placeholder="sk-..."
				bind:value={formApiKey}
				hint={t('settings.apiKeyHint')}
			/>

			{#if !isTauriSync()}
				<label class="flex items-center gap-2">
					<input type="checkbox" class="checkbox" bind:checked={formCorsBypassEnabled} />
					<span class="text-sm font-medium text-surface-700-300">{t('settings.bypassCorsViaWispProxy')}</span>
				</label>
				{#if formCorsBypassEnabled}
					<TextField
						label={t('settings.wispProxyUrl')}
						type="url"
						placeholder="ws://localhost:6001"
						bind:value={formWispProxyUrl}
						hint={t('settings.wispProxyUrlHint')}
					/>
				{/if}
			{/if}

			<details class="mt-2">
				<summary class="text-sm font-medium cursor-pointer">{t('settings.advanced')}</summary>
				<div class="mt-2 space-y-2">
					<label class="flex items-center gap-2">
						<input type="checkbox" class="checkbox" bind:checked={formTemperatureEnabled} />
						<span class="text-sm font-medium text-surface-700-300">Temperature</span>
					</label>
					{#if formTemperatureEnabled}
						<input class="input" type="number" step="0.01" min="0" max="1" bind:value={formTemperature} />
					{/if}

					<label class="flex items-center gap-2">
						<input type="checkbox" class="checkbox" bind:checked={formTopPEnabled} />
						<span class="text-sm font-medium text-surface-700-300">Top P</span>
					</label>
					{#if formTopPEnabled}
						<input class="input" type="number" step="0.01" min="0" max="1" bind:value={formTopP} />
					{/if}

					<label class="flex items-center gap-2">
						<input type="checkbox" class="checkbox" bind:checked={formTopKEnabled} />
						<span class="text-sm font-medium text-surface-700-300">Top K</span>
					</label>
					{#if formTopKEnabled}
						<input class="input" type="number" step="1" min="0" max="100" bind:value={formTopK} />
					{/if}

					<label class="flex items-center gap-2">
						<input type="checkbox" class="checkbox" bind:checked={formPresencePenaltyEnabled} />
						<span class="text-sm font-medium text-surface-700-300">Presence Penalty</span>
					</label>
					{#if formPresencePenaltyEnabled}
						<input class="input" type="number" step="0.01" min="-1" max="1" bind:value={formPresencePenalty} />
					{/if}

					<label class="flex items-center gap-2">
						<input type="checkbox" class="checkbox" bind:checked={formFrequencyPenaltyEnabled} />
						<span class="text-sm font-medium text-surface-700-300">Frequency Penalty</span>
					</label>
					{#if formFrequencyPenaltyEnabled}
						<input class="input" type="number" step="0.01" min="-1" max="1" bind:value={formFrequencyPenalty} />
					{/if}
				</div>
			</details>
		</div>
	</details>
	<div class="flex gap-2">
		<Button variant="filled" class="min-h-11" onclick={handleSave}>
			{mode === 'edit' ? t('settings.save') : t('settings.addProviderButton')}
		</Button>
		<Button class="min-h-11" onclick={oncancel}>{t('settings.cancel')}</Button>
	</div>
</div>
