<script lang="ts">
	import { untrack } from 'svelte';
	import { t } from '#lib/i18n/index.ts';
	import type { LanguageModelCallOptions } from 'ai';
	import type { AppEffort, CatalogConstraints } from '#lib/ai/catalog/effort.ts';
	import ThemedSelect from '#lib/components/ThemedSelect.svelte';

	interface CatalogReasoning {
		toggle?: 'on' | 'off';
		budget?: number;
	}

	interface Props {
		/** Initial value; the editor manages its own field state after mount */
		callSettings?: LanguageModelCallOptions;
		onValueChange?: (callSettings: LanguageModelCallOptions | undefined) => void;
		/** When set, controls are limited to what the catalog model supports */
		catalogConstraints?: CatalogConstraints;
		/** Initial catalog-only reasoning controls (OpenRouter toggle/budget) */
		catalogReasoning?: CatalogReasoning;
		onCatalogReasoningChange?: (reasoning: CatalogReasoning) => void;
	}

	let { callSettings, onValueChange, catalogConstraints, catalogReasoning, onCatalogReasoningChange }: Props = $props();

	type ReasoningEffort = NonNullable<LanguageModelCallOptions['reasoning']>;
	type ReasoningToggleValue = 'provider-default' | 'on' | 'off';

	const REASONING_EFFORT_OPTIONS = [
		'provider-default',
		'none',
		'minimal',
		'low',
		'medium',
		'high',
		'xhigh',
		'max',
	] as const satisfies readonly ReasoningEffort[];

	const REASONING_EFFORT_LABEL_KEYS: Record<(typeof REASONING_EFFORT_OPTIONS)[number], string> = {
		'provider-default': 'settings.reasoningEfforts.providerDefault',
		none: 'settings.reasoningEfforts.none',
		minimal: 'settings.reasoningEfforts.minimal',
		low: 'settings.reasoningEfforts.low',
		medium: 'settings.reasoningEfforts.medium',
		high: 'settings.reasoningEfforts.high',
		xhigh: 'settings.reasoningEfforts.xhigh',
		max: 'settings.reasoningEfforts.max',
	};

	// A catalog entry with no effort option has no effort control at all; only the unconstrained case falls back to the full list.
	const showReasoningEffort = $derived(!catalogConstraints || catalogConstraints.effortValues !== undefined);

	// Provider default is always offered; a constrained list only drops unsupported efforts.
	const allowedEfforts = $derived(catalogConstraints?.effortValues ? new Set<AppEffort>(catalogConstraints.effortValues) : undefined);

	const reasoningEffortItems = $derived<{ label: string; value: ReasoningEffort }[]>(
		REASONING_EFFORT_OPTIONS.filter((value) => !allowedEfforts || value === 'provider-default' || allowedEfforts.has(value)).map(
			(value) => ({ label: t(REASONING_EFFORT_LABEL_KEYS[value]), value })
		)
	);

	const reasoningToggleItems = $derived<{ label: string; value: ReasoningToggleValue }[]>([
		{ label: t('settings.reasoningEfforts.providerDefault'), value: 'provider-default' },
		{ label: t('settings.reasoningOn'), value: 'on' },
		{ label: t('settings.reasoningOff'), value: 'off' },
	]);

	const temperatureSupported = $derived(catalogConstraints?.temperatureSupported ?? true);

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
	// svelte-ignore state_referenced_locally
	let reasoningToggle = $state<ReasoningToggleValue>(catalogReasoning?.toggle ?? 'provider-default');
	// svelte-ignore state_referenced_locally
	let reasoningBudget = $state<number | undefined>(catalogReasoning?.budget);

	function emitCatalogReasoning() {
		onCatalogReasoningChange?.({
			toggle: reasoningToggle === 'provider-default' ? undefined : reasoningToggle,
			budget: reasoningBudget,
		});
	}

	$effect(() => {
		const cs: LanguageModelCallOptions = {};
		if (temperatureSupported && temperatureEnabled) cs.temperature = temperature;
		if (topPEnabled) cs.topP = topP;
		if (topKEnabled) cs.topK = topK;
		if (presencePenaltyEnabled) cs.presencePenalty = presencePenalty;
		if (frequencyPenaltyEnabled) cs.frequencyPenalty = frequencyPenalty;
		// 'provider-default' means no override, so it is not persisted; a catalog entry without an effort option never emits one
		if (showReasoningEffort && reasoningEffort !== 'provider-default') cs.reasoning = reasoningEffort;
		// untrack: the parent recreates the callback prop on re-render, which would re-trigger this effect
		untrack(() => onValueChange?.(Object.keys(cs).length > 0 ? cs : undefined));
	});
</script>

<div class="space-y-2">
	{#if temperatureSupported}
		<label class="flex items-center gap-2">
			<input type="checkbox" class="checkbox" bind:checked={temperatureEnabled} />
			<span class="text-sm font-medium text-surface-700-300">Temperature</span>
		</label>
		{#if temperatureEnabled}
			<input class="input" type="number" step="0.01" min="0" max="1" bind:value={temperature} />
		{/if}
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

	{#if showReasoningEffort}
		<label class="block">
			<span class="text-sm font-medium text-surface-700-300">{t('settings.reasoningEffort')}</span>
			<ThemedSelect items={reasoningEffortItems} value={reasoningEffort} onValueChange={(v) => (reasoningEffort = v)} />
		</label>
	{/if}

	{#if catalogConstraints?.hasToggle}
		<label class="block">
			<span class="text-sm font-medium text-surface-700-300">{t('chat.reasoning')}</span>
			<ThemedSelect
				items={reasoningToggleItems}
				value={reasoningToggle}
				onValueChange={(v) => {
					reasoningToggle = v;
					emitCatalogReasoning();
				}}
			/>
		</label>
	{/if}

	{#if catalogConstraints?.hasBudget}
		<label class="block">
			<span class="text-sm font-medium text-surface-700-300">{t('settings.reasoningBudget')}</span>
			<input
				class="input mt-1"
				type="number"
				step="1"
				min={catalogConstraints?.budgetMin}
				max={catalogConstraints?.budgetMax}
				value={reasoningBudget ?? ''}
				placeholder="tokens"
				oninput={(e) => {
					const value = e.currentTarget.valueAsNumber;
					reasoningBudget = Number.isFinite(value) ? value : undefined;
					emitCatalogReasoning();
				}}
			/>
		</label>
	{/if}
</div>
