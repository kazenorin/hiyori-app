<script lang="ts">
	import { isMemoryAvailable, isMemoryCapable, settings, updateSettings } from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import RoleCallSettingsOverride from '$lib/components/chat/RoleCallSettingsOverride.svelte';
	import { getRoleItems } from '$lib/features/settings-options';
</script>

<Card title={t('settings.memory')} description={t('settings.enableMemoryDescription')}>
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

	<div class="block">
		<span class="text-sm font-medium text-surface-700-300">{t('settings.memoryProvider')}</span>
		<ThemedSelect
			items={getRoleItems()}
			value={settings.memoryProviderRole}
			onValueChange={(v) => updateSettings({ memoryProviderRole: v })}
			disabled={!settings.memoryEnabled || !isMemoryAvailable()}
			placeholder={t('settings.noProvidersConfigured')}
		/>
		<span class="text-xs text-surface-500 mt-1 block">{t('settings.memoryProviderDescription')}</span>
		<RoleCallSettingsOverride role="memory" />
	</div>

	<div class="block">
		<span class="text-sm font-medium text-surface-700-300">{t('settings.embeddingProvider')}</span>
		<ThemedSelect
			items={getRoleItems()}
			value={settings.embeddingProviderRole}
			onValueChange={(v) => updateSettings({ embeddingProviderRole: v })}
			disabled={!settings.memoryEnabled || !isMemoryAvailable()}
			placeholder={t('settings.noProvidersConfigured')}
		/>
		<span class="text-xs text-surface-500 mt-1 block">{t('settings.embeddingProviderDescription')}</span>
		<RoleCallSettingsOverride role="embedding" />
	</div>
</Card>
