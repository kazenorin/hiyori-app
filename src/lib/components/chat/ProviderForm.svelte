<script lang="ts">
	import { t } from '$lib/i18n';
	import { fetchModels, type ModelInfo } from '$lib/ai/models';
	import { isTauriSync } from '$lib/runtime';
	import type { ApiType, Provider, ProviderConfig } from '$lib/stores/settings.svelte';
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

	let formName = $state(config?.name ?? '');
	let formProvider = $state<Provider>(config?.provider ?? 'openai');
	let formApiType = $state<ApiType>(config?.apiType ?? 'responses');
	let formBaseURL = $state(config?.baseURL ?? 'https://api.openai.com/v1');
	let formModel = $state(config?.model ?? '');
	let formApiKey = $state(config?.apiKey ?? '');
	let formCorsBypassEnabled = $state(config?.corsBypassEnabled ?? false);
	let formWispProxyUrl = $state(config?.wispProxyUrl ?? 'ws://localhost:6001');

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
				hint={t('settings.baseUrlHint')}
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
		</div>
	</details>
	<div class="flex gap-2">
		<Button variant="filled" class="min-h-11" onclick={handleSave}>
			{mode === 'edit' ? t('settings.save') : t('settings.addProviderButton')}
		</Button>
		<Button class="min-h-11" onclick={oncancel}>{t('settings.cancel')}</Button>
	</div>
</div>
