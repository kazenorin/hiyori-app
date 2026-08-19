<script lang="ts">
	import { settings, updateSettings, type LogLevel } from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { getLogLevelItems } from '$lib/features/settings-options';

	const logLevelItems = $derived(getLogLevelItems());
</script>

<Card title={t('settings.developer')}>
	<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
		<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.logLevel')}</h3>
		<ThemedSelect items={logLevelItems} value={settings.logLevel} onValueChange={(v) => updateSettings({ logLevel: v as LogLevel })} />
		<span class="text-xs text-surface-500 block">{t('settings.logLevelDescription')}</span>
	</div>
</Card>
