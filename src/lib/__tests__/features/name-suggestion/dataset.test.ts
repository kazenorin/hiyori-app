import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryFileSystem } from '$lib/fs/file-system-in-memory';
import { setFileSystem } from '$lib/fs/file-system';

vi.mock('$lib/logging/logger', () => ({
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	fileLog: vi.fn(),
}));

import { parseNameDataset } from '$lib/features/name-suggestion/csv';
import { getNameDataset } from '$lib/features/name-suggestion/dataset';
import { WORLD_TEMPLATES } from '$lib/features/world-builder/template-registry';

const csvFiles = import.meta.glob('../../../fs/*/names/**/*.csv', {
	eager: true,
	query: '?raw',
	import: 'default',
}) as Record<string, string>;

function localeOf(path: string): string {
	return path.replace('../../../fs/', '').split('/')[0];
}

function bundledEntries() {
	return Object.values(csvFiles).flatMap((content) => parseNameDataset(content));
}

describe('bundled name dataset', () => {
	it('ships a CSV file for each content locale', () => {
		const locales = new Set(Object.keys(csvFiles).map(localeOf));
		expect(locales.has('en')).toBe(true);
		expect(locales.has('zh-Hant-HK')).toBe(true);
	});

	it('contains no invalid rows — curated data must stay clean', () => {
		const invalid: string[] = [];
		for (const [path, content] of Object.entries(csvFiles)) {
			parseNameDataset(content, (line, reason) => invalid.push(`${path}:${line}:${reason}`));
		}
		expect(invalid).toEqual([]);
	});

	it('only references real world themes', () => {
		const validThemes = new Set(WORLD_TEMPLATES.map((t) => t.id));
		const badThemes = bundledEntries().flatMap((e) => e.themes).filter((t) => !validThemes.has(t));
		expect([...new Set(badThemes)]).toEqual([]);
	});
});

describe('getNameDataset', () => {
	let memFs: InMemoryFileSystem;

	beforeEach(() => {
		memFs = new InMemoryFileSystem();
		setFileSystem(memFs);
	});

	it('loads the bundled en dataset through the file system', async () => {
		const data = await getNameDataset('en');
		expect(data.length).toBeGreaterThan(0);
		expect(data.some((e) => e.name === 'Aragorn')).toBe(true);
	});

	it('loads a distinct zh-Hant-HK dataset', async () => {
		const data = await getNameDataset('zh-Hant-HK');
		expect(data.some((e) => e.name === '王')).toBe(true);
	});

	it('falls back to en for a locale with no data', async () => {
		const fr = (await getNameDataset('fr')).map((e) => e.name).sort();
		const en = (await getNameDataset('en')).map((e) => e.name).sort();
		expect(fr).toEqual(en);
	});

	it('respects a user-edited AppData override', async () => {
		const custom = 'name,gender,themes,cultures,nameTypes,meaningTags\nZzzcustom,masculine,high-fantasy,european,given,noble\n';
		await memFs.writeTextFileEnsuringDir('config/en/names/masculine.csv', custom);
		const names = (await getNameDataset('en')).map((e) => e.name);
		expect(names).toContain('Zzzcustom'); // override content loaded
		expect(names).not.toContain('Aragorn'); // bundled masculine.csv replaced
		expect(names).toContain('Elowen'); // feminine.csv still bundled
	});
});
