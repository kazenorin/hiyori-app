<script lang="ts">
	import { t } from '$lib/i18n';
	import type { ProviderConfigTip } from '$lib/ai/provider-tips/evaluator';
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { IconName } from '$lib/ui/icons';

	interface Props {
		tip: ProviderConfigTip | null;
		onapply?: (tip: ProviderConfigTip) => void;
	}

	let { tip, onapply }: Props = $props();

	const ICON: Record<ProviderConfigTip['kind'], IconName> = {
		warning: 'triangle-alert',
		note: 'info',
		verified: 'circle-check',
	};

	const TEXT_CLASS: Record<ProviderConfigTip['kind'], string> = {
		warning: 'text-warning-500',
		note: 'text-primary-500',
		verified: 'text-success-500',
	};
</script>

{#if tip}
	<div class="text-xs flex flex-wrap gap-2 items-center mt-1">
		<Icon name={ICON[tip.kind]} class="size-4 shrink-0 {TEXT_CLASS[tip.kind]}" aria-hidden="true" />
		{#if tip.kind === 'verified'}
			<div class="badge preset-filled-success-500 text-success-contrast-500 text-xs">
				{t('settings.providerTips.verifiedBadge')}
			</div>
		{/if}
		<span class={TEXT_CLASS[tip.kind]}>
			{t(tip.messageKey, tip.messageParams)}
		</span>
		{#if tip.suggest && onapply}
			<button type="button" class="btn btn-sm preset-tonal shrink-0" onclick={() => onapply(tip)}>
				{t('settings.providerTips.apply')}
			</button>
		{/if}
	</div>
{/if}
