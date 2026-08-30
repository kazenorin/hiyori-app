<script lang="ts">
	import {
		addProviderConfig,
		assignRole,
		deleteProviderConfig,
		settings,
		updateProviderConfig,
		type ProviderConfig,
	} from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import ProviderForm from '$lib/components/chat/ProviderForm.svelte';

	let editingId = $state<string | null>(null);
	let isAddingNew = $state(false);

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
</script>

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
			<div class="flex items-center justify-between p-3 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150">
				<div class="min-w-0">
					<p class="text-sm font-medium truncate">{config.name}</p>
					<p class="text-xs text-surface-500 truncate">
						{config.provider === 'openai'
							? t('settings.providers.openai')
							: config.provider === 'ollama'
								? t('settings.providers.ollama')
								: config.provider === 'openrouter'
									? t('settings.providers.openrouter')
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
