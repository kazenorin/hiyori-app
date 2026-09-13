<script lang="ts">
	import { getMinorTaskAgentProviderConfig, settings, updateSettings } from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';
	import Card from '$lib/components/ui/Card.svelte';
	import NumberField from '$lib/components/ui/NumberField.svelte';
</script>

<div class="space-y-4">
	<Card title={t('settings.narrative')}>
		<!-- Word Count, Compressor & Summarization Point: full-width card -->
		<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-4">
			<NumberField
				label={t('settings.targetWordCount')}
				hint={t('settings.targetWordCountDescription')}
				min={50}
				max={2000}
				step={50}
				value={settings.targetWordCount}
				onValueChange={(v) => {
					if (v >= 50 && v <= 2000) updateSettings({ targetWordCount: v });
				}}
			/>
			<NumberField
				label={t('settings.compressorInterval')}
				hint={t('settings.compressorIntervalDescription')}
				min={0}
				max={50}
				step={1}
				value={settings.characterProfileCompressorInterval}
				onValueChange={(v) => {
					if (v >= 0 && v <= 50) updateSettings({ characterProfileCompressorInterval: v });
				}}
			/>
			<NumberField
				label={t('settings.summarizationPointInterval')}
				hint={t('settings.summarizationPointIntervalDescription')}
				min={0}
				max={50}
				step={1}
				value={settings.summarizationPointInterval}
				onValueChange={(v) => {
					if (v >= 0 && v <= 50) updateSettings({ summarizationPointInterval: v });
				}}
			/>
		</div>

		<!-- Experimental: stage-2 shared-prefix context (A/B flag) -->
		<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					class="checkbox"
					checked={settings.pipelineContextV2}
					onchange={(e) => updateSettings({ pipelineContextV2: (e.currentTarget as HTMLInputElement).checked })}
				/>
				<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.pipelineContextV2')}</h3>
			</label>
			<span class="text-xs text-surface-500 block">{t('settings.pipelineContextV2Description')}</span>
		</div>

		<!-- Director Mode & Phrase Highlighting: side-by-side mini-cards -->
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<div class="flex items-center gap-2">
					<input
						type="checkbox"
						class="checkbox"
						checked={settings.directorModeEnabled}
						onchange={(e) => updateSettings({ directorModeEnabled: (e.currentTarget as HTMLInputElement).checked })}
					/>
					<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.directorMode')}</h3>
				</div>
				<span class="text-xs text-surface-500 block">{t('settings.directorModeDescription')}</span>
			</div>

			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<label class="flex items-center gap-2">
					<input
						type="checkbox"
						class="checkbox"
						checked={settings.importantPhraseHighlighting}
						disabled={!getMinorTaskAgentProviderConfig()}
						onchange={(e) => updateSettings({ importantPhraseHighlighting: (e.currentTarget as HTMLInputElement).checked })}
					/>
					<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.phraseHighlighting')}</h3>
				</label>
				<span class="text-xs text-surface-500 block">{t('settings.phraseHighlightingDescription')}</span>
			</div>
		</div>

		<!-- Phase Advancement Thresholds: half-card grid -->
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<NumberField
					label={t('settings.phaseAdvancementThreshold')}
					hint={t('settings.phaseAdvancementThresholdDescription')}
					min={0}
					max={10}
					step={1}
					value={settings.phaseAdvancementThreshold}
					onValueChange={(v) => {
						if (v >= 0 && v <= 10) updateSettings({ phaseAdvancementThreshold: v });
					}}
				/>
			</div>
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<NumberField
					label={t('settings.playerDivergenceThreshold')}
					hint={t('settings.playerDivergenceThresholdDescription')}
					min={0}
					max={10}
					step={1}
					value={settings.playerDivergenceThreshold}
					onValueChange={(v) => {
						if (v >= 0 && v <= 10) updateSettings({ playerDivergenceThreshold: v });
					}}
				/>
			</div>
		</div>
	</Card>

	<Card title={t('settings.inventory')} description={t('settings.enableInventoryDescription')}>
		<label class="flex items-center gap-2">
			<input
				type="checkbox"
				class="checkbox"
				checked={settings.inventoryEnabled}
				onchange={(e) => updateSettings({ inventoryEnabled: (e.currentTarget as HTMLInputElement).checked })}
			/>
			<span class="text-sm font-medium text-surface-700-300">{t('settings.enableInventory')}</span>
		</label>
	</Card>
</div>
