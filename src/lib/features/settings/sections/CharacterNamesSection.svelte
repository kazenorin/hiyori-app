<script lang="ts">
	import { getNameSuggestionQuotas, settings, updateSettings } from '$lib/stores/settings.svelte';
	import { DEFAULT_NAME_QUOTAS, type NameQuotaConfig } from '$lib/features/name-suggestion/quota';
	import { getNameDataset, getNameDatasetPool } from '$lib/features/name-suggestion/dataset';
	import { CULTURE_META, CULTURES, type Culture } from '$lib/features/name-suggestion/types';
	import { SUPPORTED_LOCALES } from '$lib/fs/prompt-loader';
	import { getLocaleItems } from '$lib/features/settings-options';
	import { t } from '$lib/i18n';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import NumberField from '$lib/components/ui/NumberField.svelte';
	import Card from '$lib/components/ui/Card.svelte';

	function cloneQuotas(q: NameQuotaConfig): NameQuotaConfig {
		return {
			budgets: Object.fromEntries(Object.entries(q.budgets).map(([locale, budgets]) => [locale, { ...budgets }])),
			ratio: { ...q.ratio },
		};
	}

	// Auto-apply: write a mutated clone straight to settings (no draft/save).
	function updateQuotas(mutate: (q: NameQuotaConfig) => void): void {
		const next = cloneQuotas(getNameSuggestionQuotas());
		mutate(next);
		void updateSettings({ nameSuggestionQuotas: next });
	}

	const localeItems = getLocaleItems();

	let selectedLocale = $state((SUPPORTED_LOCALES as readonly string[]).includes(settings.locale) ? settings.locale : 'en');
	let counts = $state<Record<string, { active: number; total: number }> | null>(null);

	function budgetFor(locale: string, culture: Culture): number {
		const q = getNameSuggestionQuotas();
		return q.budgets[locale]?.[culture] ?? DEFAULT_NAME_QUOTAS.budgets[locale]?.[culture] ?? 0;
	}

	function setBudget(culture: Culture, value: number): void {
		updateQuotas((q) => {
			if (!q.budgets[selectedLocale]) q.budgets[selectedLocale] = {};
			q.budgets[selectedLocale]![culture] = value;
		});
	}

	function setRatio(key: 'given' | 'family' | 'nickname', value: number): void {
		updateQuotas((q) => {
			q.ratio[key] = value;
		});
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
		if (settings.characterNameSuggestionMode === 'analytic') {
			// Read quotas synchronously so auto-applied edits re-trigger the count refresh.
			getNameSuggestionQuotas();
			void refreshCounts(selectedLocale);
		}
	});
</script>

<div class="space-y-4">
	<Card title={t('settings.characterNameEngine')}>
		<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
			<div class="flex items-center gap-2">
				<span class="text-xs font-medium text-surface-500">{t('settings.characterNameEngineMode')}</span>
				<ThemedSelect
					items={[
						{ label: t('settings.characterNameEngineAi'), value: 'ai' },
						{ label: t('settings.characterNameEngineAnalytic'), value: 'analytic' },
					]}
					value={settings.characterNameSuggestionMode}
					onValueChange={(v) => updateSettings({ characterNameSuggestionMode: v as 'ai' | 'analytic' })}
				/>
			</div>
			<span class="text-xs text-surface-500 block"
				>{settings.characterNameSuggestionMode === 'ai'
					? t('settings.characterNameEngineAiDescription')
					: t('settings.characterNameEngineAnalyticDescription')}</span
			>
		</div>
	</Card>

	{#if settings.characterNameSuggestionMode === 'analytic'}
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
						value={getNameSuggestionQuotas().ratio.given}
						onValueChange={(v) => {
							if (v >= 0 && v <= 100) setRatio('given', v);
						}}
					/>
				</div>
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4">
					<NumberField
						label={t('settings.nameQuotas.ratioFamily')}
						min={0}
						max={100}
						step={5}
						value={getNameSuggestionQuotas().ratio.family}
						onValueChange={(v) => {
							if (v >= 0 && v <= 100) setRatio('family', v);
						}}
					/>
				</div>
				<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4">
					<NumberField
						label={t('settings.nameQuotas.ratioNickname')}
						min={0}
						max={100}
						step={5}
						value={getNameSuggestionQuotas().ratio.nickname}
						onValueChange={(v) => {
							if (v >= 0 && v <= 100) setRatio('nickname', v);
						}}
					/>
				</div>
			</div>
		</Card>
	{/if}
</div>
