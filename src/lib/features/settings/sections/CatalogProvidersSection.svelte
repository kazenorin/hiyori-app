<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import Card from '#lib/components/ui/Card.svelte';
</script>

<Card title={t('settings.catalog.title')} description={t('settings.catalog.description')}>
	<p class="text-sm text-surface-500 py-2">{t('settings.catalog.noProviders')}</p>
</Card>
