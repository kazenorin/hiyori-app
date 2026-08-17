<script lang="ts">
	import { untrack } from 'svelte';
	import { t } from '$lib/i18n';
	import type { LanguageModelCallOptions } from 'ai';
	import ThemedSelect from '$lib/components/ThemedSelect.svelte';

	interface Props {
		/** Initial value; the editor manages its own field state after mount */
		callSettings?: LanguageModelCallOptions;
		onValueChange?: (callSettings: LanguageModelCallOptions | undefined) => void;
	}

	let { callSettings, onValueChange }: Props = $props();

	type ReasoningEffort = NonNullable<LanguageModelCallOptions['reasoning']>;

	const REASONING_EFFORT_OPTIONS: readonly ReasoningEffort[] = ['provider-default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

	const REASONING_EFFORT_LABEL_KEYS: Record<ReasoningEffort, string> = {
		'provider-default': 'settings.reasoningEfforts.providerDefault',
		none: 'settings.reasoningEfforts.none',
		minimal: 'settings.reasoningEfforts.minimal',
		low: 'settings.reasoningEfforts.low',
		medium: 'settings.reasoningEfforts.medium',
		high: 'settings.reasoningEfforts.high',
		xhigh: 'settings.reasoningEfforts.xhigh',
	};

	const reasoningEffortItems = REASONING_EFFORT_OPTIONS.map((value) => ({ label: t(REASONING_EFFORT_LABEL_KEYS[value]), value }));

	// svelte-ignore state_referenced_locally
	let temperatureEnabled = $state(callSettings?.temperature !== undefined);
	// svelte-ignore state_referenced_locally
	let temperature = $state(callSettings?.temperature ?? 0.7);
	// svelte-ignore state_referenced_locally
	let topPEnabled = $state(callSettings?.topP !== undefined);
	// svelte-ignore state_referenced_locally
	let topP = $state(callSettings?.topP ?? 1);
	// svelte-ignore state_referenced_locally
	let topKEnabled = $state(callSettings?.topK !== undefined);
	// svelte-ignore state_referenced_locally
	let topK = $state(callSettings?.topK ?? 0);
	// svelte-ignore state_referenced_locally
	let presencePenaltyEnabled = $state(callSettings?.presencePenalty !== undefined);
	// svelte-ignore state_referenced_locally
	let presencePenalty = $state(callSettings?.presencePenalty ?? 0);
	// svelte-ignore state_referenced_locally
	let frequencyPenaltyEnabled = $state(callSettings?.frequencyPenalty !== undefined);
	// svelte-ignore state_referenced_locally
	let frequencyPenalty = $state(callSettings?.frequencyPenalty ?? 0);
	// svelte-ignore state_referenced_locally
	let reasoningEffort = $state<ReasoningEffort>(callSettings?.reasoning ?? 'provider-default');

	$effect(() => {
		const cs: LanguageModelCallOptions = {};
		if (temperatureEnabled) cs.temperature = temperature;
		if (topPEnabled) cs.topP = topP;
		if (topKEnabled) cs.topK = topK;
		if (presencePenaltyEnabled) cs.presencePenalty = presencePenalty;
		if (frequencyPenaltyEnabled) cs.frequencyPenalty = frequencyPenalty;
		// 'provider-default' means no override, so it is not persisted
		if (reasoningEffort !== 'provider-default') cs.reasoning = reasoningEffort;
		// untrack: the parent recreates the callback prop on re-render, which would re-trigger this effect
		untrack(() => onValueChange?.(Object.keys(cs).length > 0 ? cs : undefined));
	});
</script>

<div class="space-y-2">
	<label class="flex items-center gap-2">
		<input type="checkbox" class="checkbox" bind:checked={temperatureEnabled} />
		<span class="text-sm font-medium text-surface-700-300">Temperature</span>
	</label>
	{#if temperatureEnabled}
		<input class="input" type="number" step="0.01" min="0" max="1" bind:value={temperature} />
	{/if}

	<label class="flex items-center gap-2">
		<input type="checkbox" class="checkbox" bind:checked={topPEnabled} />
		<span class="text-sm font-medium text-surface-700-300">Top P</span>
	</label>
	{#if topPEnabled}
		<input class="input" type="number" step="0.01" min="0" max="1" bind:value={topP} />
	{/if}

	<label class="flex items-center gap-2">
		<input type="checkbox" class="checkbox" bind:checked={topKEnabled} />
		<span class="text-sm font-medium text-surface-700-300">Top K</span>
	</label>
	{#if topKEnabled}
		<input class="input" type="number" step="1" min="0" max="100" bind:value={topK} />
	{/if}

	<label class="flex items-center gap-2">
		<input type="checkbox" class="checkbox" bind:checked={presencePenaltyEnabled} />
		<span class="text-sm font-medium text-surface-700-300">Presence Penalty</span>
	</label>
	{#if presencePenaltyEnabled}
		<input class="input" type="number" step="0.01" min="-1" max="1" bind:value={presencePenalty} />
	{/if}

	<label class="flex items-center gap-2">
		<input type="checkbox" class="checkbox" bind:checked={frequencyPenaltyEnabled} />
		<span class="text-sm font-medium text-surface-700-300">Frequency Penalty</span>
	</label>
	{#if frequencyPenaltyEnabled}
		<input class="input" type="number" step="0.01" min="-1" max="1" bind:value={frequencyPenalty} />
	{/if}

	<label class="block">
		<span class="text-sm font-medium text-surface-700-300">{t('settings.reasoningEffort')}</span>
		<ThemedSelect items={reasoningEffortItems} value={reasoningEffort} onValueChange={(v) => (reasoningEffort = v)} />
	</label>
</div>
