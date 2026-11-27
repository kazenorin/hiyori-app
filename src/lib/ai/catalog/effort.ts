import type { Provider } from '#lib/stores/settings.svelte.ts';
import type { ModelSnapshot, ReasoningOption, ReasoningEffortValue } from './types';

export type AppEffort = 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const CATALOG_TO_APP_EFFORT: Record<string, AppEffort> = {
	null: 'none',
	none: 'none',
	default: 'provider-default',
	minimal: 'minimal',
	low: 'low',
	medium: 'medium',
	high: 'high',
	xhigh: 'xhigh',
	max: 'max',
};

export function mapEffortValue(v: ReasoningEffortValue): AppEffort {
	if (v === null) return 'none';
	return CATALOG_TO_APP_EFFORT[v] ?? 'provider-default';
}

export interface CatalogConstraints {
	effortValues?: AppEffort[];
	hasToggle: boolean;
	hasBudget: boolean;
	budgetMin?: number;
	budgetMax?: number;
	temperatureSupported: boolean;
	providerType: Provider;
}

export function constraintsFromSnapshot(snapshot: ModelSnapshot, providerType: Provider): CatalogConstraints {
	const options: ReasoningOption[] = snapshot.reasoning_options ?? [];
	const effortOpt = options.find((o) => o.type === 'effort') as { type: 'effort'; values: ReasoningEffortValue[] } | undefined;
	const toggleOpt = options.find((o) => o.type === 'toggle');
	const budgetOpt = options.find((o) => o.type === 'budget_tokens') as { type: 'budget_tokens'; min?: number; max?: number } | undefined;

	const effortValues = effortOpt ? [...new Set(['provider-default' as AppEffort, ...effortOpt.values.map(mapEffortValue)])] : undefined;

	return {
		effortValues,
		hasToggle: !!toggleOpt,
		hasBudget: !!budgetOpt && providerType === 'openrouter',
		budgetMin: budgetOpt?.min === -1 ? undefined : budgetOpt?.min,
		budgetMax: budgetOpt?.max,
		temperatureSupported: snapshot.temperature !== false,
		providerType,
	};
}
