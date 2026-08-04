import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryFileSystem } from '$lib/fs/file-system-in-memory';
import { setFileSystem } from '$lib/fs/file-system';

vi.mock('$lib/logging/logger', () => ({
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	fileLog: vi.fn(),
}));

import { parseNameDataset } from '$lib/features/name-suggestion/json';
import { getNameDataset } from '$lib/features/name-suggestion/dataset';
import { normalizeName } from '$lib/features/name-suggestion/engine';
import { DEFAULT_NAME_QUOTAS } from '$lib/features/name-suggestion/quota';
import { CULTURES, NAME_THEMES, STORY_THEME_TO_NAME_THEME, type Culture } from '$lib/features/name-suggestion/types';
import { settings } from '$lib/stores/settings.svelte';
import { WORLD_TEMPLATES } from '$lib/features/world-builder/template-registry';

const jsonFiles = import.meta.glob('../../../fs/*/names/**/*.json', {
	eager: true,
	query: '?raw',
	import: 'default',
}) as Record<string, string>;

function localeOf(path: string): string {
	return path.replace('../../../fs/', '').split('/')[0];
}

function bundledEntries() {
	return Object.values(jsonFiles).flatMap((content) => parseNameDataset(content));
}

/** Budgets large enough that quota sampling never drops anything, for tests asserting specific names. */
function unlimitedQuotas() {
	const budgets: Record<string, Partial<Record<Culture, number>>> = {};
	for (const locale of ['en', 'zh-Hant-HK']) {
		budgets[locale] = Object.fromEntries(CULTURES.map((c) => [c, 10000]));
	}
	return { budgets, ratio: { ...DEFAULT_NAME_QUOTAS.ratio } };
}

describe('bundled name dataset', () => {
	it('ships JSON name files for each content locale', () => {
		const locales = new Set(Object.keys(jsonFiles).map(localeOf));
		expect(locales.has('en')).toBe(true);
		expect(locales.has('zh-Hant-HK')).toBe(true);
	});

	it('contains no invalid entries — curated data must stay clean', () => {
		const invalid: string[] = [];
		for (const [path, content] of Object.entries(jsonFiles)) {
			parseNameDataset(content, (index, reason) => invalid.push(`${path}:${index}:${reason}`));
		}
		expect(invalid).toEqual([]);
	});

	it('only references the consolidated name themes', () => {
		const badThemes = bundledEntries().flatMap((e) => e.themes).filter((t) => !(NAME_THEMES as readonly string[]).includes(t));
		expect([...new Set(badThemes)]).toEqual([]);
	});

	it('maps every world template theme so any story theme stays queryable', () => {
		const unmapped = WORLD_TEMPLATES.map((t) => t.id).filter((id) => STORY_THEME_TO_NAME_THEME[id] === undefined);
		expect(unmapped).toEqual([]);
	});
});

describe('getNameDataset', () => {
	let memFs: InMemoryFileSystem;

	beforeEach(() => {
		memFs = new InMemoryFileSystem();
		setFileSystem(memFs);
		settings.nameSuggestionQuotas = unlimitedQuotas();
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

	it('deduplicates names that appear in multiple culture files', async () => {
		const keys = (await getNameDataset('en')).map((e) => normalizeName(e.name));
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('applies the configured quotas to the loaded dataset', async () => {
		const zero = Object.fromEntries(CULTURES.map((c) => [c, 0]));
		settings.nameSuggestionQuotas = { budgets: { en: { ...zero, european: 6 } }, ratio: { given: 1, family: 0, nickname: 0 } };
		const data = await getNameDataset('en', () => 0.5);
		expect(data.length).toBeGreaterThan(0);
		expect(data.every((e) => e.cultures.includes('european'))).toBe(true);
	});

	it('respects a user-edited AppData override', async () => {
		const custom = JSON.stringify([
			{ name: 'Zzzcustom', genders: ['masculine'], themes: ['fantasy'], cultures: ['european'], nameTypes: ['given'], meaningTags: ['noble'] },
		]);
		await memFs.writeTextFileEnsuringDir('config/en/names/european.json', custom);
		const names = (await getNameDataset('en')).map((e) => e.name);
		expect(names).toContain('Zzzcustom'); // override content loaded
		expect(names).not.toContain('Aragorn'); // bundled european.json replaced
		expect(names).toContain('Elowen'); // elven.json still bundled
	});
});
