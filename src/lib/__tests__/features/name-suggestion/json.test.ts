import { describe, it, expect } from 'vitest';
import { parseNameDataset } from '$lib/features/name-suggestion/json';
import type { NameEntry } from '$lib/features/name-suggestion/types';

function dataset(entries: unknown[]): string {
	return JSON.stringify(entries);
}

const aragorn: NameEntry = {
	name: 'Aragorn',
	genders: ['masculine'],
	themes: ['fantasy'],
	cultures: ['european'],
	nameTypes: ['given'],
	meaningTags: ['noble', 'royal'],
};

/** Build a mutated copy with intentionally invalid fields (parser input is untyped JSON). */
function patched(patch: Record<string, unknown>): unknown {
	return { ...aragorn, ...patch };
}

describe('parseNameDataset', () => {
	it('parses a valid entry into a typed entry', () => {
		expect(parseNameDataset(dataset([aragorn]))).toEqual<NameEntry[]>([aragorn]);
	});

	it('supports multi-valued gender', () => {
		const entries = parseNameDataset(dataset([patched({ name: 'Yuki', genders: ['masculine', 'feminine'] })]));
		expect(entries[0].genders).toEqual(['masculine', 'feminine']);
	});

	it('accepts the nickname data name type', () => {
		const entries = parseNameDataset(dataset([patched({ name: 'Sparrow', nameTypes: ['nickname'] })]));
		expect(entries[0].nameTypes).toEqual(['nickname']);
	});

	it('allows empty and missing meaningTags', () => {
		const withEmpty = parseNameDataset(dataset([patched({ meaningTags: [] })]));
		expect(withEmpty[0].meaningTags).toEqual([]);
		const { meaningTags: _dropped, ...without } = aragorn;
		const withMissing = parseNameDataset(dataset([without]));
		expect(withMissing[0].meaningTags).toEqual([]);
	});

	it('rejects retired world-template theme ids — the dataset uses the consolidated vocabulary', () => {
		const reasons: string[] = [];
		const entries = parseNameDataset(
			dataset([patched({ name: 'X', themes: ['high-fantasy'] }), patched({ name: 'Y', themes: ['urban-fantasy'] })]),
			(_index, reason) => reasons.push(reason)
		);
		expect(entries).toEqual([]);
		expect(reasons).toEqual(['unknown theme "high-fantasy"', 'unknown theme "urban-fantasy"']);
	});

	it('rejects "full" and "simple" as data name types (full is composed, simple is retired)', () => {
		const reasons: string[] = [];
		const entries = parseNameDataset(dataset([patched({ name: 'X', nameTypes: ['full'] }), patched({ name: 'Y', nameTypes: ['simple'] })]), (_index, reason) =>
			reasons.push(reason)
		);
		expect(entries).toEqual([]);
		expect(reasons).toEqual(['unknown nameType "full"', 'unknown nameType "simple"']);
	});

	it('drops and reports invalid entries without aborting the load', () => {
		const invalid: string[] = [];
		const entries = parseNameDataset(dataset([aragorn, patched({ name: 'Bad', genders: ['alien'] })]), (index, reason) =>
			invalid.push(`${index}:${reason}`)
		);
		expect(entries.map((e) => e.name)).toEqual(['Aragorn']);
		expect(invalid).toEqual(['2:unknown gender "alien"']);
	});

	it('reports a missing name', () => {
		const reasons: string[] = [];
		parseNameDataset(dataset([patched({ name: '' })]), (_index, reason) => reasons.push(reason));
		expect(reasons).toEqual(['missing name']);
	});

	it('treats empty content as an empty dataset (files seeded for empty combos stay valid)', () => {
		expect(parseNameDataset('')).toEqual([]);
		expect(parseNameDataset('[]')).toEqual([]);
	});

	it('reports malformed JSON at index 0 instead of throwing', () => {
		const invalid: string[] = [];
		const entries = parseNameDataset('{not json', (index, reason) => invalid.push(`${index}:${reason}`));
		expect(entries).toEqual([]);
		expect(invalid.length).toBe(1);
		expect(invalid[0]).toMatch(/^0:invalid JSON/);
	});

	it('reports a non-array root', () => {
		const reasons: string[] = [];
		parseNameDataset('{"name":"X"}', (_index, reason) => reasons.push(reason));
		expect(reasons).toEqual(['expected a JSON array of name entries']);
	});
});
