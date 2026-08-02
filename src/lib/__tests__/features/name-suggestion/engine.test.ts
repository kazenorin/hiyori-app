import { describe, it, expect } from 'vitest';
import { buildExistingNameSet, formatFullName, normalizeName, suggestNames } from '$lib/features/name-suggestion/engine';
import type { NameEntry } from '$lib/features/name-suggestion/types';

function entry(overrides: Partial<NameEntry> & { name: string }): NameEntry {
	return {
		genders: ['masculine'],
		themes: ['high-fantasy'],
		cultures: ['european'],
		nameTypes: ['given'],
		meaningTags: [],
		...overrides,
	};
}

// Fixed rng so selection is deterministic; assertions use sorted sets or lengths, not order.
const rng = () => 0;
const EN = 'en';
const ZH = 'zh-Hant-HK';

describe('normalizeName', () => {
	it('produces the kebab-case canonical form', () => {
		expect(normalizeName('  Aria   Thornwood ')).toBe('aria-thornwood');
	});

	it('maps whitespace/punctuation variants to the same canonical form', () => {
		expect(normalizeName("Elena M. O'Brien")).toBe(normalizeName('elena m o brien'));
	});
});

describe('formatFullName', () => {
	it('joins given-first with a space in en', () => {
		expect(formatFullName('Aria', 'Thornwood', 'givenFirst', EN)).toBe('Aria Thornwood');
	});

	it('joins family-first with a space in en', () => {
		expect(formatFullName('Haruto', 'Sato', 'familyFirst', EN)).toBe('Sato Haruto');
	});

	it('joins family-first with no separator in zh-Hant-HK (native order)', () => {
		expect(formatFullName('小明', '王', 'familyFirst', ZH)).toBe('王小明');
	});

	it('joins given-first with the dot character in zh-Hant-HK (transliteration)', () => {
		expect(formatFullName('湯姆', '索亞', 'givenFirst', ZH)).toBe('湯姆·索亞');
	});

	it('returns the given name alone for noFamily cultures', () => {
		expect(formatFullName('Grosh', 'Grak', 'noFamily', EN)).toBe('Grosh');
	});
});

describe('suggestNames — direct filtering', () => {
	it('returns every unused direct name when no filters are given', () => {
		const data = [entry({ name: 'A' }), entry({ name: 'B' })];
		const names = suggestNames(data, {}, new Set(), EN, rng).map((e) => e.name).sort();
		expect(names).toEqual(['A', 'B']);
	});

	it('matches a dimension when the entry intersects the query (ANY-of)', () => {
		const data = [
			entry({ name: 'Fantasy', themes: ['high-fantasy'] }),
			entry({ name: 'Modern', themes: ['modern-slice-of-life'] }),
			entry({ name: 'Both', themes: ['high-fantasy', 'urban-fantasy'] }),
		];
		const names = suggestNames(data, { themes: ['high-fantasy', 'urban-fantasy'], count: 20 }, new Set(), EN, rng)
			.map((e) => e.name)
			.sort();
		expect(names).toEqual(['Both', 'Fantasy']);
	});

	it('treats multiple query genders as a union', () => {
		const data = [
			entry({ name: 'Masc', genders: ['masculine'] }),
			entry({ name: 'Fem', genders: ['feminine'] }),
			entry({ name: 'Neu', genders: ['neutral'] }),
		];
		const names = suggestNames(data, { genders: ['masculine', 'neutral'], count: 20 }, new Set(), EN, rng)
			.map((e) => e.name)
			.sort();
		expect(names).toEqual(['Masc', 'Neu']);
	});

	it('returns empty when nothing matches', () => {
		const data = [entry({ name: 'A', cultures: ['european'] })];
		expect(suggestNames(data, { cultures: ['elven'] }, new Set(), EN, rng)).toEqual([]);
	});

	it('preserves meaning tags on returned entries so the response can show them', () => {
		const data = [entry({ name: 'Aragorn', meaningTags: ['noble', 'royal'] })];
		expect(suggestNames(data, {}, new Set(), EN, rng)[0].meaningTags).toEqual(['noble', 'royal']);
	});
});

describe('suggestNames — nameTypes and full composition', () => {
	const aria = entry({ name: 'Aria', genders: ['feminine'], nameTypes: ['given'], meaningTags: ['heroic', 'noble'] });
	const thornwood = entry({ name: 'Thornwood', genders: ['neutral'], nameTypes: ['family'], meaningTags: ['noble', 'pastoral'] });

	it('omitting nameTypes returns direct forms only and never composes full names', () => {
		const names = suggestNames([aria, thornwood], { count: 20 }, new Set(), EN, rng).map((e) => e.name).sort();
		expect(names).toEqual(['Aria', 'Thornwood']);
	});

	it('requesting only "full" returns composed names, not the raw parts', () => {
		const names = suggestNames([aria, thornwood], { nameTypes: ['full'], count: 20 }, new Set(), EN, rng).map((e) => e.name);
		expect(names).toEqual(['Aria Thornwood']);
	});

	it('requesting "full" and "given" returns both composed and direct names', () => {
		const names = suggestNames([aria, thornwood], { nameTypes: ['full', 'given'], count: 20 }, new Set(), EN, rng)
			.map((e) => e.name)
			.sort();
		expect(names).toEqual(['Aria', 'Aria Thornwood']);
	});

	it('composes a family-first full name in zh-Hant-HK', () => {
		const ming = entry({ name: '小明', cultures: ['chinese'], nameTypes: ['given'] });
		const wang = entry({ name: '王', genders: ['neutral'], cultures: ['chinese'], nameTypes: ['family'] });
		const names = suggestNames([ming, wang], { nameTypes: ['full'], count: 20 }, new Set(), ZH, rng).map((e) => e.name);
		expect(names).toEqual(['王小明']);
	});

	it('composes a given-first transliteration with the dot character in zh-Hant-HK', () => {
		const tom = entry({ name: '湯姆', cultures: ['european'], nameTypes: ['given'] });
		const sawyer = entry({ name: '索亞', genders: ['neutral'], cultures: ['european'], nameTypes: ['family'] });
		const names = suggestNames([tom, sawyer], { nameTypes: ['full'], count: 20 }, new Set(), ZH, rng).map((e) => e.name);
		expect(names).toEqual(['湯姆·索亞']);
	});

	it('does not compose full names for noFamily cultures even when family entries exist', () => {
		const grosh = entry({ name: 'Grosh', cultures: ['orcish'], nameTypes: ['given'] });
		const grak = entry({ name: 'Grak', genders: ['neutral'], cultures: ['orcish'], nameTypes: ['family'] });
		expect(suggestNames([grosh, grak], { nameTypes: ['full'], count: 20 }, new Set(), EN, rng)).toEqual([]);
	});

	it('unions the meaning tags of the given and family parts', () => {
		const result = suggestNames([aria, thornwood], { nameTypes: ['full'], count: 20 }, new Set(), EN, rng);
		expect(result[0].meaningTags).toEqual(['heroic', 'noble', 'pastoral']);
	});

	it('selects family names without regard to the gender filter (surnames are shared)', () => {
		// Thornwood is neutral; a feminine query still composes because gender applies to the given part only.
		const names = suggestNames([aria, thornwood], { genders: ['feminine'], nameTypes: ['full'], count: 20 }, new Set(), EN, rng).map(
			(e) => e.name
		);
		expect(names).toEqual(['Aria Thornwood']);
	});
});

describe('suggestNames — avoidance level', () => {
	const used = [entry({ name: 'Used' })];
	const existing = buildExistingNameSet([{ preferredName: 'Used', aliases: [] }]);

	it('always avoids existing names at level 5', () => {
		const data = [entry({ name: 'Used' }), entry({ name: 'Free' })];
		for (let seed = 0; seed < 20; seed++) {
			const variedRng = () => (seed % 10) / 10;
			const names = suggestNames(data, { count: 20, avoidanceLevel: 5 }, existing, EN, variedRng).map((e) => e.name);
			expect(names).not.toContain('Used');
		}
	});

	it('never avoids existing names at level 0', () => {
		const names = suggestNames(used, { count: 20, avoidanceLevel: 0 }, existing, EN, () => 0.99).map((e) => e.name);
		expect(names).toContain('Used');
	});

	it('keeps a colliding name at level 3 when the roll fails to reject (>= 0.6)', () => {
		const names = suggestNames(used, { count: 20, avoidanceLevel: 3 }, existing, EN, () => 0.9).map((e) => e.name);
		expect(names).toEqual(['Used']);
	});

	it('rejects a colliding name at level 3 when the roll succeeds (< 0.6)', () => {
		expect(suggestNames(used, { count: 20, avoidanceLevel: 3 }, existing, EN, () => 0.1)).toEqual([]);
	});

	it('excludes a name matching an existing alias, case-insensitively (at full avoidance)', () => {
		const data = [entry({ name: 'Aria' })];
		const aliasExisting = buildExistingNameSet([{ preferredName: 'Someone Else', aliases: [' aria '] }]);
		expect(suggestNames(data, { avoidanceLevel: 5 }, aliasExisting, EN, rng)).toEqual([]);
	});
});

describe('suggestNames — count and dedup', () => {
	it('returns at most the requested count', () => {
		const data = [entry({ name: 'A' }), entry({ name: 'B' }), entry({ name: 'C' })];
		expect(suggestNames(data, { count: 2 }, new Set(), EN, rng)).toHaveLength(2);
	});

	it('clamps count to the number of available matches', () => {
		const data = [entry({ name: 'A' }), entry({ name: 'B' })];
		expect(suggestNames(data, { count: 20 }, new Set(), EN, rng)).toHaveLength(2);
	});

	it('deduplicates identical names appearing across multiple files', () => {
		const data = [entry({ name: 'Dup' }), entry({ name: 'Dup' }), entry({ name: 'Other' })];
		const names = suggestNames(data, { count: 20 }, new Set(), EN, rng).map((e) => e.name).sort();
		expect(names).toEqual(['Dup', 'Other']);
	});
});
