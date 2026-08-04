import { CULTURE_META, CULTURES, DATA_NAME_TYPES, type Culture, type DataNameType, type NameEntry } from './types';

/** Relative weights for splitting a culture budget across name types. Normalized by sum, so 60/30/10 and 0.6/0.3/0.1 behave identically. */
export interface NameTypeRatio {
	given: number;
	family: number;
	nickname: number;
}

/**
 * Per-locale dataset composition quotas. `budgets[locale][culture]` is the total
 * number of names kept for that culture; the ratio splits it across name types.
 * Locales/cultures missing from a user config resolve to the defaults.
 */
export interface NameQuotaConfig {
	budgets: Record<string, Partial<Record<Culture, number>>>;
	ratio: NameTypeRatio;
}

export const DEFAULT_NAME_QUOTAS: NameQuotaConfig = {
	budgets: {
		en: {
			european: 120,
			japanese: 80,
			chinese: 80,
			'middle-eastern': 60,
			african: 60,
			'south-asian': 60,
			latin: 60,
			elven: 50,
			dwarven: 40,
			celestial: 40,
			orcish: 30,
			draconic: 30,
			infernal: 30,
		},
		'zh-Hant-HK': {
			chinese: 120,
			japanese: 50,
			european: 40,
			'middle-eastern': 15,
			african: 15,
			'south-asian': 15,
			latin: 15,
			elven: 10,
			dwarven: 10,
			celestial: 10,
			orcish: 10,
			draconic: 10,
			infernal: 10,
		},
	},
	ratio: { given: 60, family: 30, nickname: 10 },
};

/** Locale whose budgets apply when a locale has none of its own (dataset loading falls back the same way). */
export const QUOTA_FALLBACK_LOCALE = 'en';

/**
 * Resolve the total budget for a locale/culture. Per-culture resolution order:
 * user config for the locale → defaults for the locale → user config for the
 * fallback locale → defaults for the fallback locale → 0. An explicit 0 in the
 * user config disables a culture.
 */
export function resolveBudget(config: NameQuotaConfig, locale: string, culture: Culture): number {
	const user = config.budgets?.[locale]?.[culture];
	if (user !== undefined) return user;
	const localDefault = DEFAULT_NAME_QUOTAS.budgets[locale]?.[culture];
	if (localDefault !== undefined) return localDefault;
	const fallbackUser = config.budgets?.[QUOTA_FALLBACK_LOCALE]?.[culture];
	if (fallbackUser !== undefined) return fallbackUser;
	return DEFAULT_NAME_QUOTAS.budgets[QUOTA_FALLBACK_LOCALE]?.[culture] ?? 0;
}

/**
 * Split a culture budget into per-name-type quotas using the normalized ratio.
 * Cultures without family names fold the family share into given names.
 */
export function allocateQuotas(budget: number, ratio: NameTypeRatio, noFamily = false): Record<DataNameType, number> {
	const sum = ratio.given + ratio.family + ratio.nickname;
	const effective = sum > 0 ? ratio : DEFAULT_NAME_QUOTAS.ratio;
	const effectiveSum = effective.given + effective.family + effective.nickname;

	const given = Math.round(budget * (effective.given / effectiveSum));
	const family = Math.round(budget * (effective.family / effectiveSum));
	const nickname = Math.round(budget * (effective.nickname / effectiveSum));

	if (noFamily) {
		return { given: given + family, family: 0, nickname };
	}
	return { given, family, nickname };
}

/**
 * Curate the dataset down to the configured quotas. Entries are grouped by
 * (culture, nameType); each group keeps at most its quota, chosen by random
 * sampling (injectable `rng` for deterministic tests). An entry survives if
 * any of its groups keeps it. Counts are deterministic (`min(available,
 * quota)`); membership varies per call.
 */
export function applyQuotas(entries: NameEntry[], config: NameQuotaConfig, locale: string, rng: () => number = Math.random): NameEntry[] {
	const quotas = new Map<Culture, Record<DataNameType, number>>();
	for (const culture of CULTURES) {
		const noFamily = CULTURE_META[culture].nameOrder === 'noFamily';
		quotas.set(culture, allocateQuotas(resolveBudget(config, locale, culture), config.ratio, noFamily));
	}

	const groups = new Map<Culture, Map<DataNameType, number[]>>();
	for (let index = 0; index < entries.length; index++) {
		for (const culture of entries[index].cultures) {
			for (const type of entries[index].nameTypes) {
				let byType = groups.get(culture);
				if (!byType) {
					byType = new Map<DataNameType, number[]>();
					groups.set(culture, byType);
				}
				const indices = byType.get(type) ?? [];
				indices.push(index);
				byType.set(type, indices);
			}
		}
	}

	const kept = new Set<number>();
	for (const [culture, byType] of groups) {
		const cultureQuotas = quotas.get(culture);
		if (!cultureQuotas) continue;
		for (const type of DATA_NAME_TYPES) {
			const indices = byType.get(type);
			if (!indices) continue;
			const quota = cultureQuotas[type];
			if (quota <= 0) continue;
			if (indices.length <= quota) {
				for (const index of indices) kept.add(index);
				continue;
			}
			const pool = [...indices];
			for (let i = 0; i < quota; i++) {
				const j = i + Math.floor(rng() * (pool.length - i));
				[pool[i], pool[j]] = [pool[j], pool[i]];
				kept.add(pool[i]);
			}
		}
	}

	return entries.filter((_, index) => kept.has(index));
}
