<script lang="ts">
	import { t } from '$lib/i18n';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';
</script>

<svelte:head>
	<title>{t('contextManagement.title')}</title>
</svelte:head>

<div class="flex-1 overflow-y-auto p-3 md:p-4 lg:p-6">
	<div class="max-w-2xl mx-auto space-y-6">
		<h1 class="h1">{t('contextManagement.title')}</h1>
		<p class="text-surface-500">{t('contextManagement.subtitle')}</p>

		<div class="space-y-3">
			<div class="flex items-center gap-2">
				<h2 class="font-semibold text-base text-surface-700-300">{t('contextManagement.advancedSectionTitle')}</h2>
			</div>
			<p class="text-sm text-surface-500">{t('contextManagement.advancedSectionDescription')}</p>

			<a
				href={resolve('/context-management/act-card')}
				class="card preset-tonal p-4 block hover:bg-surface-200-800 transition-colors duration-150 cursor-pointer"
			>
				<div class="flex items-center justify-between gap-3">
					<span class="font-semibold text-lg text-surface-950-50">{t('contextManagement.actCard.title')}</span>
					<Icon name="chevron-down" class="size-5 -rotate-90 text-surface-500" />
				</div>
				<p class="text-sm text-surface-500 mt-1">{t('contextManagement.actCard.description')}</p>
			</a>

			<a
				href={resolve('/context-management/character-cards')}
				class="card preset-tonal p-4 block hover:bg-surface-200-800 transition-colors duration-150 cursor-pointer"
			>
				<div class="flex items-center justify-between gap-3">
					<span class="font-semibold text-lg text-surface-950-50">{t('contextManagement.characterCards.title')}</span>
					<Icon name="chevron-down" class="size-5 -rotate-90 text-surface-500" />
				</div>
				<p class="text-sm text-surface-500 mt-1">{t('contextManagement.characterCards.description')}</p>
			</a>

			<div class="card p-4 border border-secondary-500-300">
				<div class="flex items-start gap-2">
					<Icon name="info" class="size-5 shrink-0 text-secondary-500 mt-0.5" />
					<p class="text-sm text-surface-700-300">{t('contextManagement.costNote')}</p>
				</div>
			</div>
		</div>

		<div class="flex justify-center">
			<button class="btn btn-sm preset-tonal min-h-11" onclick={() => goto(resolve('/'))}>
				&larr; {t('characterCards.back')}
			</button>
		</div>
	</div>
</div>
