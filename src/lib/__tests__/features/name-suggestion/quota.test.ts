import { describe, it, expect } from 'vitest';
import { allocateQuotas, applyQuotas, DEFAULT_NAME_QUOTAS, resolveBudget, type NameQuotaConfig } from '$lib/features/name-suggestion/quota';
import type { Culture, DataNameType, NameEntry } from '$lib/features/name-suggestion/types';

/** Deterministic PRNG so sampling assertions are reproducible. */
function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function entry(name: string, culture: Culture, nameTypes: DataNameType[]): NameEntry {
	return { name, genders: ['neutral'], themes: ['fantasy'], cultures: [culture], nameTypes, meaningTags: [] };
}

function configFor(budget: number, locale = 'en', culture: Culture = 'european'): NameQuotaConfig {
	return { budgets: { [locale]: { [culture]: budget } }, ratio: { ...DEFAULT_NAME_QUOTAS.ratio } };
}

describe('allocateQuotas', () => {
	it('splits a budget by the default 60/30/10 ratio', () => {
		expect(allocateQuotas(100, DEFAULT_NAME_QUOTAS.ratio)).toEqual({ given: 60, family: 30, nickname: 10 });
	});

	it('normalizes arbitrary weights so 6/3/1 behaves like 60/30/10', () => {
		expect(allocateQuotas(100, { given: 6, family: 3, nickname: 1 })).toEqual({ given: 60, family: 30, nickname: 10 });
	});

	it('folds the family share into given for cultures without family names', () => {
		const q = allocateQuotas(100, DEFAULT_NAME_QUOTAS.ratio, true);
		expect(q).toEqual({ given: 90, family: 0, nickname: 10 });
	});

	it('falls back to the default ratio when weights sum to zero', () => {
		expect(allocateQuotas(100, { given: 0, family: 0, nickname: 0 })).toEqual({ given: 60, family: 30, nickname: 10 });
	});
});

describe('DEFAULT_NAME_QUOTAS', () => {
	it('matches the budgets the CSV generator shipped, so dataset sizes stay stable across the migration', () => {
		expect(DEFAULT_NAME_QUOTAS.budgets.en).toEqual({
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
		});
		expect(DEFAULT_NAME_QUOTAS.budgets['zh-Hant-HK']).toEqual({
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
		});
		expect(DEFAULT_NAME_QUOTAS.ratio).toEqual({ given: 60, family: 30, nickname: 10 });
	});
});

describe('resolveBudget', () => {
	it('prefers the user config for the locale', () => {
		const config = configFor(42);
		expect(resolveBudget(config, 'en', 'european')).toBe(42);
	});

	it('falls back to the default budget when the user config omits a culture', () => {
		const config = configFor(42);
		expect(resolveBudget(config, 'en', 'japanese')).toBe(DEFAULT_NAME_QUOTAS.budgets.en?.japanese);
	});

	it('falls back to en budgets for locales that have none (dataset loading falls back the same way)', () => {
		expect(resolveBudget(DEFAULT_NAME_QUOTAS, 'fr', 'european')).toBe(DEFAULT_NAME_QUOTAS.budgets.en?.european);
	});
});

describe('applyQuotas', () => {
	it('keeps every entry when pools are within quota', () => {
		const entries = [entry('A', 'european', ['given']), entry('B', 'european', ['family'])];
		const result = applyQuotas(entries, configFor(100), 'en', mulberry32(1));
		expect(result).toEqual(entries);
	});

	it('caps an over-quota group at exactly its quota', () => {
		const entries = Array.from({ length: 20 }, (_, i) => entry(`Name${i}`, 'european', ['given']));
		const result = applyQuotas(entries, configFor(10), 'en', mulberry32(1));
		expect(result.length).toBe(6); // given quota = round(10 * 0.6)
		expect(result.every((e) => e.cultures.includes('european'))).toBe(true);
	});

	it('samples deterministically for a fixed rng', () => {
		const entries = Array.from({ length: 20 }, (_, i) => entry(`Name${i}`, 'european', ['given']));
		const first = applyQuotas(entries, configFor(10), 'en', mulberry32(7)).map((e) => e.name);
		const second = applyQuotas(entries, configFor(10), 'en', mulberry32(7)).map((e) => e.name);
		expect(first).toEqual(second);
	});

	it('drops a culture entirely when its budget is zero', () => {
		const entries = [entry('A', 'european', ['given']), entry('B', 'orcish', ['given'])];
		const config = configFor(10);
		config.budgets.en = { european: 10, orcish: 0 };
		const result = applyQuotas(entries, config, 'en', mulberry32(1));
		expect(result.map((e) => e.name)).toEqual(['A']);
	});

	it('keeps a multi-type entry when any of its groups keeps it', () => {
		const shared = entry('Shared', 'european', ['given', 'nickname']);
		const entries = [shared, ...Array.from({ length: 15 }, (_, i) => entry(`Given${i}`, 'european', ['given']))];
		const result = applyQuotas(entries, configFor(10), 'en', mulberry32(1));
		expect(result.map((e) => e.name)).toContain('Shared');
	});
});
