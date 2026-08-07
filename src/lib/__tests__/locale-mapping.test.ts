import { describe, it, expect } from 'vitest';
import { localeMatches, getAllowedVoiceLanguages, isTTSSupportedLocale, getVoicesForLocale } from '$lib/kokoro/locale-mapping';

describe('localeMatches', () => {
	it('matches exact and prefixed values case-insensitively', () => {
		expect(localeMatches('en', 'en')).toBe(true);
		expect(localeMatches('en-US', 'en')).toBe(true);
		expect(localeMatches('en-GB', 'en')).toBe(true);
		expect(localeMatches('EN-us', 'en')).toBe(true);
		expect(localeMatches('zh-Hant-HK', 'zh')).toBe(true);
		expect(localeMatches('zh-Hans', 'zh')).toBe(true);
		expect(localeMatches('zh', 'zh')).toBe(true);
	});

	it('rejects non-matching values', () => {
		expect(localeMatches('enish', 'en')).toBe(false);
		expect(localeMatches('es', 'en')).toBe(false);
		expect(localeMatches('yue', 'zh')).toBe(false);
	});
});

describe('getAllowedVoiceLanguages', () => {
	it('maps en locales to en voice language', () => {
		expect(getAllowedVoiceLanguages('en')).toEqual(['en']);
		expect(getAllowedVoiceLanguages('en-US')).toEqual(['en']);
		expect(getAllowedVoiceLanguages('en-GB')).toEqual(['en']);
	});

	it('maps zh locales to zh and yue voice languages', () => {
		expect(getAllowedVoiceLanguages('zh')).toEqual(['zh', 'yue']);
		expect(getAllowedVoiceLanguages('zh-Hant-HK')).toEqual(['zh', 'yue']);
		expect(getAllowedVoiceLanguages('zh-Hans')).toEqual(['zh', 'yue']);
	});

	it('maps yue locales to zh and yue voice languages', () => {
		expect(getAllowedVoiceLanguages('yue')).toEqual(['zh', 'yue']);
	});

	it('returns empty for unsupported locales', () => {
		expect(getAllowedVoiceLanguages('fr')).toEqual([]);
		expect(getAllowedVoiceLanguages('ja')).toEqual([]);
	});
});

describe('isTTSSupportedLocale', () => {
	it('supports en and zh locales', () => {
		expect(isTTSSupportedLocale('en')).toBe(true);
		expect(isTTSSupportedLocale('en-US')).toBe(true);
		expect(isTTSSupportedLocale('zh-Hant-HK')).toBe(true);
		expect(isTTSSupportedLocale('zh-Hans')).toBe(true);
	});

	it('rejects unsupported and empty locales', () => {
		expect(isTTSSupportedLocale('fr')).toBe(false);
		expect(isTTSSupportedLocale(null)).toBe(false);
		expect(isTTSSupportedLocale(undefined)).toBe(false);
	});
});

describe('getVoicesForLocale', () => {
	it('returns only English voices for en locales', () => {
		const voices = getVoicesForLocale('en');
		expect(voices.length).toBeGreaterThan(0);
		expect(voices.every(([, voice]) => voice.language.startsWith('en'))).toBe(true);
	});

	it('returns only Mandarin voices for zh locales', () => {
		const voices = getVoicesForLocale('zh-Hant-HK');
		expect(voices.length).toBeGreaterThan(0);
		expect(voices.every(([, voice]) => voice.language.startsWith('zh'))).toBe(true);
	});

	it('returns no voices for unsupported locales', () => {
		expect(getVoicesForLocale('fr')).toEqual([]);
	});
});
