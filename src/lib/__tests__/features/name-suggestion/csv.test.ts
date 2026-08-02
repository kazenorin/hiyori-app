import { describe, it, expect } from 'vitest';
import { parseCsvLine, parseNameDataset } from '$lib/features/name-suggestion/csv';
import type { NameEntry } from '$lib/features/name-suggestion/types';

const HEADER = 'name,gender,themes,cultures,nameTypes,meaningTags';

function dataset(rows: string[]): string {
	return [HEADER, ...rows].join('\n');
}

describe('parseCsvLine', () => {
	it('splits simple comma-delimited fields', () => {
		expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
	});

	it('keeps commas inside double-quoted fields', () => {
		expect(parseCsvLine('"Smith, John",x')).toEqual(['Smith, John', 'x']);
	});

	it('unescapes doubled quotes inside quoted fields', () => {
		expect(parseCsvLine('"say ""hi""",x')).toEqual(['say "hi"', 'x']);
	});
});

describe('parseNameDataset', () => {
	it('parses a valid row into a typed entry', () => {
		const entries = parseNameDataset(dataset(['Aragorn,masculine,high-fantasy,european,given,noble;royal']));
		expect(entries).toEqual<NameEntry[]>([
			{
				name: 'Aragorn',
				genders: ['masculine'],
				themes: ['high-fantasy'],
				cultures: ['european'],
				nameTypes: ['given'],
				meaningTags: ['noble', 'royal'],
			},
		]);
	});

	it('supports multi-valued gender', () => {
		const entries = parseNameDataset(dataset(['Yuki,masculine;feminine,modern-slice-of-life,japanese,given,serene']));
		expect(entries[0].genders).toEqual(['masculine', 'feminine']);
	});

	it('accepts the nickname data name type', () => {
		const entries = parseNameDataset(dataset(['Sparrow,neutral,urban-fantasy,european,nickname,wild']));
		expect(entries[0].nameTypes).toEqual(['nickname']);
	});

	it('allows empty meaningTags', () => {
		const entries = parseNameDataset(dataset(['Bob,masculine,modern-slice-of-life,european,given,']));
		expect(entries[0].meaningTags).toEqual([]);
	});

	it('skips the header row', () => {
		expect(parseNameDataset(HEADER)).toEqual([]);
	});

	it('rejects "full" and "simple" as data name types (full is composed, simple is retired)', () => {
		const reasons: string[] = [];
		const entries = parseNameDataset(
			dataset(['X,masculine,high-fantasy,european,full,noble', 'Y,masculine,high-fantasy,european,simple,noble']),
			(_line, reason) => reasons.push(reason)
		);
		expect(entries).toEqual([]);
		expect(reasons).toEqual(['unknown nameType "full"', 'unknown nameType "simple"']);
	});

	it('drops and reports invalid rows without aborting the load', () => {
		const invalid: string[] = [];
		const entries = parseNameDataset(
			dataset(['Aragorn,masculine,high-fantasy,european,given,noble', 'Bad,alien,high-fantasy,european,given,noble']),
			(line, reason) => invalid.push(`${line}:${reason}`)
		);
		expect(entries.map((e) => e.name)).toEqual(['Aragorn']);
		expect(invalid).toEqual(['3:unknown gender "alien"']);
	});

	it('reports a missing name', () => {
		const reasons: string[] = [];
		parseNameDataset(dataset([',masculine,high-fantasy,european,given,noble']), (_line, reason) => reasons.push(reason));
		expect(reasons).toEqual(['missing name']);
	});
});
