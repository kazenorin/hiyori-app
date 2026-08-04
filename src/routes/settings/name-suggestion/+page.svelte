<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n';
	import { getNameSuggestionQuotas, settings, updateSettings } from '$lib/stores/settings.svelte';
	import { DEFAULT_NAME_QUOTAS, type NameQuotaConfig } from '$lib/features/name-suggestion/quota';
	import { getNameDataset, getNameDatasetPool } from '$lib/features/name-suggestion/dataset';
	import { CULTURE_META, CULTURES, type Culture } from '$lib/features/name-suggestion/types';
	import { SUPPORTED_LOCALES } from '$lib/fs/prompt-loader';
	import { getLocaleItems } from '$lib/features/settings-options';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import NumberField from '$lib/components/ui/NumberField.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';

	function cloneQuotas(q: NameQuotaConfig): NameQuotaConfig {
		return {
			budgets: Object.fromEntries(Object.entries(q.budgets).map(([locale, budgets]) => [locale, { ...budgets }])),
			ratio: { ...q.ratio },
		};
	}

	const localeItems = getLocaleItems();

	let selectedLocale = $state((SUPPORTED_LOCALES as readonly string[]).includes(settings.locale) ? settings.locale : 'en');
	let draft = $state<NameQuotaConfig>(cloneQuotas(getNameSuggestionQuotas()));
	let counts = $state<Record<string, { active: number; total: number }> | null>(null);
	let saving = $state(false);

	function budgetFor(locale: string, culture: Culture): number {
		return draft.budgets[locale]?.[culture] ?? DEFAULT_NAME_QUOTAS.budgets[locale]?.[culture] ?? 0;
	}

	function setBudget(culture: Culture, value: number): void {
		if (!draft.budgets[selectedLocale]) draft.budgets[selectedLocale] = {};
		draft.budgets[selectedLocale]![culture] = value;
	}

	async function refreshCounts(locale: string): Promise<void> {
		const [pool, active] = await Promise.all([getNameDatasetPool(locale), getNameDataset(locale, () => 0.5)]);
		if (locale !== selectedLocale) return;
		const next: Record<string, { active: number; total: number }> = {};
		for (const culture of CULTURES) {
			next[culture] = {
				active: active.filter((e) => e.cultures.includes(culture)).length,
				total: pool.filter((e) => e.cultures.includes(culture)).length,
			};
		}
		counts = next;
	}

	$effect(() => {
		void refreshCounts(selectedLocale);
	});

	async function handleSave(): Promise<void> {
		saving = true;
		try {
			await updateSettings({ nameSuggestionQuotas: cloneQuotas(draft) });
			await refreshCounts(selectedLocale);
		} finally {
			saving = false;
		}
	}

	function handleBack(): void {
		goto(resolve('/settings'));
	}
</script>

<svelte:head>
	<title>{t('settings.nameQuotas.title')}</title>
</svelte:head>

<div class="flex-1 overflow-y-auto p-3 md:p-4 lg:p-6">
	<div class="max-w-2xl mx-auto space-y-6">
		<div class="space-y-2">
			<button class="btn btn-sm preset-tonal min-h-11 inline-flex self-start" onclick={handleBack}>
				&larr; {t('settings.back')}
			</button>
			<h1 class="h2 font-display">{t('settings.nameQuotas.title')}</h1>
			<p class="text-sm text-surface-500">{t('settings.nameQuotas.description')}</p>
		</div>

		<Card title={t('settings.nameQuotas.localeSection')}>
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<ThemedSelect items={localeItems} value={selectedLocale} onValueChange={(v) => (selectedLocale = v)} />
			</div>
		</Card>

		<Card title={t('settings.nameQuotas.budgetsSection')} description={t('settings.nameQuotas.budgetsDescription')}>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				{#each CULTURES as culture (culture)}
					<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-2">
						<NumberField
							label={t(`settings.nameQuotas.cultures.${culture}`)}
							hint={counts
								? t('settings.nameQuotas.activeCount', {
										active: counts[culture]?.active ?? 0,
										total: counts[culture]?.total ?? 0,
									})
								: undefined}
							min={0}
							max={1000}
							step={5}
							value={budgetFor(selectedLocale, culture)}
							onValueChange={(v) => {
								if (v >= 0 && v <= 1000) setBudget(culture, v);
							}}
						/>
						{#if CULTURE_META[culture].nameOrder === 'noFamily'}
							<span class="text-xs text-surface-500 block">{t('settings.nameQuotas.noFamilyHint')}</span>
						{/if}
					</div>
				{/each}
			</div>
		</Card>

		<Card title={t('settings.nameQuotas.ratioSection')} description={t('settings.nameQuotas.ratioDescription')}>
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4">
					<NumberField
						label={t('settings.nameQuotas.ratioGiven')}
						min={0}
						max={100}
						step={5}
						value={draft.ratio.given}
						onValueChange={(v) => {
							if (v >= 0 && v <= 100) draft.ratio.given = v;
						}}
					/>
				</div>
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4">
					<NumberField
						label={t('settings.nameQuotas.ratioFamily')}
						min={0}
						max={100}
						step={5}
						value={draft.ratio.family}
						onValueChange={(v) => {
							if (v >= 0 && v <= 100) draft.ratio.family = v;
						}}
					/>
				</div>
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4">
					<NumberField
						label={t('settings.nameQuotas.ratioNickname')}
						min={0}
						max={100}
						step={5}
						value={draft.ratio.nickname}
						onValueChange={(v) => {
							if (v >= 0 && v <= 100) draft.ratio.nickname = v;
						}}
					/>
				</div>
			</div>
		</Card>

		<div class="flex justify-end">
			<Button onclick={handleSave} disabled={saving}>{t('settings.nameQuotas.save')}</Button>
		</div>
	</div>
</div>
