<script lang="ts">
	import { t } from '$lib/i18n';
	import { getRoleCallSettings, setRoleCallSettings } from '$lib/stores/settings.svelte';
	import AdvancedSettingsEditor from '$lib/components/chat/AdvancedSettingsEditor.svelte';

	interface Props {
		role: string;
	}

	let { role }: Props = $props();

	const override = $derived(getRoleCallSettings(role));
</script>

<details>
	<summary class="text-xs font-medium text-surface-600-400 cursor-pointer">{t('settings.advanced')}</summary>
	<div class="mt-2 space-y-2">
		<label class="flex items-center gap-2">
			<input
				type="checkbox"
				class="checkbox"
				checked={override !== undefined}
				onchange={(e) => setRoleCallSettings(role, (e.currentTarget as HTMLInputElement).checked ? {} : undefined)}
			/>
			<span class="text-xs text-surface-500">{t('settings.overrideAdvancedSettings')}</span>
		</label>
		<span class="text-xs text-surface-500 block">{t('settings.advancedSettingsFollowHint')}</span>
		{#if override !== undefined}
			<!-- `cs ?? {}`: an enabled override with no fields set still replaces the provider's settings -->
			<AdvancedSettingsEditor callSettings={override} onValueChange={(cs) => setRoleCallSettings(role, cs ?? {})} />
		{/if}
	</div>
</details>
