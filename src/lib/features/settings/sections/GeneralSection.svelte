<script lang="ts">
	import { settings, updateSettings, type ThemeMode } from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import { getLocaleItems, getThemeModeItems, getColorThemeItems } from '$lib/features/settings-options';

	const localeItems = $derived(getLocaleItems());
	const themeModeItems = $derived(getThemeModeItems());
	const colorThemeItems = $derived(getColorThemeItems());
</script>

<Card title={t('settings.appearance')} description={t('settings.appearanceDescription')}>
	<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
		<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.locale')}</h3>
		<ThemedSelect items={localeItems} value={settings.locale} onValueChange={(v) => updateSettings({ locale: v })} />
		<span class="text-xs text-surface-500 block">{t('settings.localeDescription')}</span>
	</div>
	<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
		<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
			<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.colorTheme')}</h3>
			<ThemedSelect items={colorThemeItems} value={settings.colorTheme} onValueChange={(v) => updateSettings({ colorTheme: v })} />
		</div>
		<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
			<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.themeMode')}</h3>
			<ThemedSelect
				items={themeModeItems}
				value={settings.themeMode}
				onValueChange={(v) => updateSettings({ themeMode: v as ThemeMode })}
			/>
		</div>
	</div>
</Card>
