<script lang="ts">
	import { t } from '$lib/i18n';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
</script>

<svelte:head>
	<title>{t('contextManagement.title')}</title>
</svelte:head>

<div class="flex-1 overflow-y-auto p-3 md:p-4 lg:p-6">
	<div class="max-w-2xl mx-auto space-y-6">
		<h1 class="h1">{t('contextManagement.title')}</h1>
		<p class="text-surface-500">{t('contextManagement.subtitle')}</p>

		<a href={resolve('/context-management/act-card')} class="card preset-tonal p-4 block">
			<h2 class="h2">{t('contextManagement.actCard.title')}</h2>
			<p class="text-sm text-surface-500">{t('contextManagement.actCard.description')}</p>
		</a>

		<a href={resolve('/context-management/character-cards')} class="card preset-tonal p-4 block">
			<h2 class="h2">{t('contextManagement.characterCards.title')}</h2>
			<p class="text-sm text-surface-500">{t('contextManagement.characterCards.description')}</p>
		</a>

		<div class="flex justify-center">
			<button class="btn btn-sm preset-tonal min-h-11" onclick={() => goto(resolve('/'))}>
				&larr; {t('characterCards.back')}
			</button>
		</div>
	</div>
</div>
