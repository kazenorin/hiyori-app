<script lang="ts">
	import { assignRole, settings, updateSettings } from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import RoleCallSettingsOverride from '$lib/components/chat/RoleCallSettingsOverride.svelte';
	import { getRoleItems, getReviewerModeItems } from '$lib/features/settings-options';

	const mainProviderId = $derived(settings.roleAssignments['main']);
	const reviewerModeItems = $derived(getReviewerModeItems());
</script>

<div class="space-y-4">
	<Card title={t('settings.providerRoles')} description={t('settings.providerRolesDescription')}>
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.mainProvider')}</h3>
				<ThemedSelect
					items={getRoleItems(false)}
					value={mainProviderId}
					onValueChange={(v) => assignRole('main', v)}
					disabled={settings.providers.length === 0}
					placeholder={t('settings.noProvidersConfigured')}
				/>
				<span class="text-xs text-surface-500 block">{t('settings.mainProviderDescription')}</span>
				<RoleCallSettingsOverride role="main" />
			</div>

			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.minorTaskAgent')}</h3>
				<ThemedSelect
					items={getRoleItems()}
					value={settings.minorTaskAgentProviderRole}
					onValueChange={(v) => updateSettings({ minorTaskAgentProviderRole: v })}
					disabled={settings.providers.length === 0}
					placeholder={t('settings.noProvidersConfigured')}
				/>
				<span class="text-xs text-surface-500 block">{t('settings.minorTaskAgentDescription')}</span>
				<RoleCallSettingsOverride role="minorTaskAgent" />
			</div>
		</div>
	</Card>

	<Card title={t('settings.pipelineRoles')} description={t('settings.pipelineRolesDescription')}>
		<!-- Plot Planner: full-width mini-card -->
		<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
			<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.plotPlanner')}</h3>
			<div class="flex items-center gap-2">
				<label class="flex items-center gap-1">
					<input
						type="checkbox"
						class="checkbox"
						checked={settings.plotPlannerEnabled}
						disabled={settings.providers.length === 0}
						onchange={(e) => updateSettings({ plotPlannerEnabled: (e.currentTarget as HTMLInputElement).checked })}
					/>
					<span class="text-xs text-surface-500">{t('settings.enabled')}</span>
				</label>
				<ThemedSelect
					items={getRoleItems()}
					value={settings.plotPlannerProviderRole}
					onValueChange={(v) => updateSettings({ plotPlannerProviderRole: v })}
					disabled={settings.providers.length === 0 || !settings.plotPlannerEnabled}
					placeholder={t('settings.noProvidersConfigured')}
				/>
			</div>
			<p class="text-xs text-surface-500">{t('settings.plotPlannerDescription')} {t('settings.enablePlotPlannerDescription')}</p>
			<div class="flex items-center gap-2">
				<span class="text-xs text-surface-500">{t('settings.plotMode')}</span>
				<ThemedSelect
					items={[
						{ label: t('settings.plotModeGuidance'), value: 'guidance' },
						{ label: t('settings.plotModePhaseEvent'), value: 'phaseEvent' },
					]}
					value={settings.defaultPlotMode}
					onValueChange={(v) => updateSettings({ defaultPlotMode: v as 'guidance' | 'phaseEvent' })}
					disabled={!settings.plotPlannerEnabled}
				/>
			</div>
			<span class="text-xs text-surface-500 block">{t('settings.plotModeDescription')}</span>
			<div class="flex items-center gap-2">
				<span class="text-xs text-surface-500">{t('settings.reevaluationFrequency')}</span>
				<input
					type="number"
					class="input text-xs w-16"
					min="1"
					max="20"
					value={settings.reevaluationFrequency}
					disabled={!settings.plotPlannerEnabled}
					onchange={(e) => {
						const val = parseInt((e.currentTarget as HTMLInputElement).value, 10);
						if (!isNaN(val) && val >= 1 && val <= 20) updateSettings({ reevaluationFrequency: val });
					}}
				/>
			</div>
			<span class="text-xs text-surface-500 block">{t('settings.reevaluationFrequencyDescription')}</span>
			<RoleCallSettingsOverride role="plotPlanner" />
		</div>

		<!-- Reviewer: full-width mini-card -->
		<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
			<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.reviewer')}</h3>
			<div class="flex items-center gap-2">
				<label class="flex items-center gap-1">
					<input
						type="checkbox"
						class="checkbox"
						checked={settings.reviewerEnabled}
						disabled={settings.providers.length === 0}
						onchange={(e) => updateSettings({ reviewerEnabled: (e.currentTarget as HTMLInputElement).checked })}
					/>
					<span class="text-xs text-surface-500">{t('settings.enabled')}</span>
				</label>
				<ThemedSelect
					items={getRoleItems()}
					value={settings.reviewerProviderRole}
					onValueChange={(v) => updateSettings({ reviewerProviderRole: v })}
					disabled={settings.providers.length === 0 || !settings.reviewerEnabled}
					placeholder={t('settings.noProvidersConfigured')}
				/>
			</div>
			<p class="text-xs text-surface-500">{t('settings.reviewerDescription')} {t('settings.enableReviewerDescription')}</p>
			<div>
				<span class="text-xs font-medium text-surface-500">{t('settings.reviewerMode')}</span>
				<ThemedSelect
					items={reviewerModeItems}
					value={settings.reviewerMode}
					onValueChange={(v) => updateSettings({ reviewerMode: v as 'detailed' | 'quick' })}
					disabled={!settings.reviewerEnabled}
				/>
				<span class="text-xs text-surface-500 block mt-1"
					>{settings.reviewerMode === 'detailed'
						? t('settings.reviewerModeDetailedDescription')
						: t('settings.reviewerModeQuickDescription')}</span
				>
			</div>
			<RoleCallSettingsOverride role="reviewer" />
		</div>

		<!-- 2x2 grid: Writer, Editor, Game Master, Summarizer -->
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
			<!-- Writer -->
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.writer')}</h3>
				<ThemedSelect
					items={getRoleItems()}
					value={settings.writerProviderRole}
					onValueChange={(v) => updateSettings({ writerProviderRole: v })}
					disabled={settings.providers.length === 0}
					placeholder={t('settings.noProvidersConfigured')}
				/>
				<span class="text-xs text-surface-500 block">{t('settings.writerDescription')}</span>
				<RoleCallSettingsOverride role="writer" />
			</div>

			<!-- Editor -->
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.editor')}</h3>
				<ThemedSelect
					items={getRoleItems()}
					value={settings.editorProviderRole}
					onValueChange={(v) => updateSettings({ editorProviderRole: v })}
					disabled={!settings.reviewerEnabled || settings.providers.length === 0}
					placeholder={t('settings.noProvidersConfigured')}
				/>
				<span class="text-xs text-surface-500 block">{t('settings.editorDescription')}</span>
				{#if !settings.reviewerEnabled}
					<span class="text-xs text-surface-500">{t('settings.editorRequiresReviewer')}</span>
				{/if}
				<RoleCallSettingsOverride role="editor" />
			</div>

			<!-- Game Master -->
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.gameMaster')}</h3>
				<ThemedSelect
					items={getRoleItems()}
					value={settings.gameMasterProviderRole}
					onValueChange={(v) => updateSettings({ gameMasterProviderRole: v })}
					disabled={settings.providers.length === 0}
					placeholder={t('settings.noProvidersConfigured')}
				/>
				<span class="text-xs text-surface-500 block">{t('settings.gameMasterDescription')}</span>
				<RoleCallSettingsOverride role="gameMaster" />
			</div>

			<!-- Summarizer -->
			<div class="bg-surface-100-900 border border-surface-200-800 rounded-lg p-4 space-y-3">
				<h3 class="text-sm font-semibold text-surface-700-300">{t('settings.summarizer')}</h3>
				<ThemedSelect
					items={getRoleItems()}
					value={settings.summarizerProviderRole}
					onValueChange={(v) => updateSettings({ summarizerProviderRole: v })}
					disabled={settings.providers.length === 0}
					placeholder={t('settings.noProvidersConfigured')}
				/>
				<span class="text-xs text-surface-500 block">{t('settings.summarizerDescription')}</span>
				<RoleCallSettingsOverride role="summarizer" />
			</div>
		</div>
	</Card>
</div>
