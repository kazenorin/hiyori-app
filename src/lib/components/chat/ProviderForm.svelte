<script lang="ts">
	import { t } from '$lib/i18n';
	import { fetchModels, type ModelInfo } from '$lib/ai/models';
	import { isTauriSync, getPlatformSync } from '$lib/runtime';
	import type { ApiType, Provider, ProviderConfig } from '$lib/stores/settings.svelte';
	import type { LanguageModelCallOptions } from 'ai';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import TextField from '$lib/components/ui/TextField.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import ProviderTips from '$lib/components/chat/ProviderTips.svelte';
	import AdvancedSettingsEditor from '$lib/components/chat/AdvancedSettingsEditor.svelte';
	import {
		evaluateProviderTip,
		expandSuggestionTemplate,
		applyStripSuffix,
		type TipEvaluationInput,
		type ProviderConfigTip,
	} from '$lib/ai/provider-tips/evaluator';

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
	let formCallSettings = $state<LanguageModelCallOptions | undefined>(config?.callSettings);

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

	// Above this count, a searchable dialog replaces the themed select
	const MODEL_DIALOG_THRESHOLD = 5;

	let modelPickerOpen = $state(false);
	let modelSearchQuery = $state('');

	const useModelDialog = $derived(availableModels.length > MODEL_DIALOG_THRESHOLD);
	const filteredModels = $derived(
		modelSearchQuery.trim()
			? availableModels.filter((m) => m.id.toLowerCase().includes(modelSearchQuery.trim().toLowerCase()))
			: availableModels
	);

	function handleOpenModelPicker() {
		modelSearchQuery = '';
		modelPickerOpen = true;
	}

	function handleSelectModel(id: string) {
		formModel = id;
		modelPickerOpen = false;
	}

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
			callSettings: formCallSettings,
		});
	}

	const tipInput = $derived<TipEvaluationInput>({
		provider: formProvider,
		baseURL: formBaseURL,
		model: formModel,
		apiType: formApiType,
		corsBypassEnabled: formCorsBypassEnabled,
		wispProxyUrl: formWispProxyUrl,
		pageProtocol: typeof window !== 'undefined' ? (window.location.protocol.replace(':', '') as 'http' | 'https') : undefined,
		platform: getPlatformSync(),
		apiKey: formApiKey,
	});

	const tip = $derived<ProviderConfigTip | null>(evaluateProviderTip(tipInput));

	function handleApplySuggestion(t: ProviderConfigTip) {
		if (!t.suggest) return;
		const input = tipInput;
		switch (t.suggest.type) {
			case 'rewriteBaseUrl': {
				formBaseURL = expandSuggestionTemplate(t.suggest.value, input);
				break;
			}
			case 'rewriteBaseUrlStripSuffix': {
				formBaseURL = applyStripSuffix(formBaseURL, t.suggest.value);
				break;
			}
			case 'rewriteBaseUrlScheme': {
				formBaseURL = formBaseURL.replace(/^http:\/\//, 'https://');
				break;
			}
			case 'switchProvider': {
				formProvider = t.suggest.value;
				if (t.suggest.rewriteBaseUrl) {
					formBaseURL = expandSuggestionTemplate(t.suggest.rewriteBaseUrl, input);
				}
				break;
			}
		}
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
						{#if availableModels.length > 0 && useModelDialog}
							<button
								type="button"
								class="mt-1 w-full min-h-11 px-4 rounded-lg border border-surface-200-800 bg-surface-50-950 hover:bg-surface-100-900 text-surface-950-50 text-sm text-left flex items-center justify-between gap-2 transition-colors"
								onclick={handleOpenModelPicker}
							>
								<span class="truncate" class:opacity-50={!formModel}>{formModel || t('settings.modelPlaceholder')}</span>
								<Icon name="chevron-down" class="w-4 h-4 shrink-0 opacity-50" />
							</button>
						{:else if availableModels.length > 0}
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

			<Modal bind:open={modelPickerOpen} title={t('settings.chooseModel')} width="lg" onclose={() => (modelPickerOpen = false)}>
				{#snippet body()}
					<input class="input w-full" type="search" placeholder={t('settings.searchModels')} bind:value={modelSearchQuery} />
					<div class="mt-3 max-h-[60vh] overflow-y-auto space-y-2 pr-1">
						{#if filteredModels.length === 0}
							<p class="text-sm text-surface-500 text-center py-4">{t('settings.noMatchingModels')}</p>
						{:else}
							{#each filteredModels as model (model.id)}
								<button
									type="button"
									class="w-full px-3 py-2 rounded-lg text-left text-sm transition-colors flex items-center justify-between gap-2 {formModel ===
									model.id
										? 'bg-primary-500/10 text-primary-500'
										: 'hover:bg-surface-200-800'}"
									onclick={() => handleSelectModel(model.id)}
								>
									<span class="truncate">{model.id}</span>
									<Icon name={formModel === model.id ? 'circle-dot' : 'circle'} class="w-4 h-4 shrink-0" />
								</button>
							{/each}
						{/if}
					</div>
				{/snippet}
			</Modal>

			<ProviderTips {tip} onapply={handleApplySuggestion} />

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
				<div class="mt-2">
					<AdvancedSettingsEditor callSettings={formCallSettings} onValueChange={(cs) => (formCallSettings = cs)} />
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
