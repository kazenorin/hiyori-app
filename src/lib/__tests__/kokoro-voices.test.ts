import { describe, it, expect } from 'vitest';
import { VOICE_LIST, DEFAULT_VOICE, getVoiceLabel } from '$lib/kokoro/voices';

describe('VOICE_LIST', () => {
	it('contains 28 voices', () => {
		expect(VOICE_LIST.length).toBe(28);
	});

	it('each voice has required fields', () => {
		for (const voice of VOICE_LIST) {
			expect(voice.id).toBeTruthy();
			expect(voice.name).toBeTruthy();
			expect(['en-us', 'en-gb']).toContain(voice.language);
			expect(['Female', 'Male']).toContain(voice.gender);
			expect(voice.quality).toBeTruthy();
		}
	});

	it('has unique IDs', () => {
		const ids = VOICE_LIST.map((v) => v.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('af_heart is the first voice (highest quality)', () => {
		expect(VOICE_LIST[0].id).toBe('af_heart');
	});

	it('American voices come before British voices', () => {
		const lastUsIdx = VOICE_LIST.findLastIndex((v) => v.language === 'en-us');
		const firstGbIdx = VOICE_LIST.findIndex((v) => v.language === 'en-gb');
		expect(firstGbIdx).toBeGreaterThan(lastUsIdx);
	});
});

describe('DEFAULT_VOICE', () => {
	it('is af_heart', () => {
		expect(DEFAULT_VOICE).toBe('af_heart');
	});

	it('exists in VOICE_LIST', () => {
		expect(VOICE_LIST.some((v) => v.id === DEFAULT_VOICE)).toBe(true);
	});
});

describe('getVoiceLabel', () => {
	it('formats American female voice', () => {
		const heart = VOICE_LIST.find((v) => v.id === 'af_heart')!;
		expect(getVoiceLabel(heart)).toBe('Heart (Female, American English)');
	});

	it('formats British male voice', () => {
		const george = VOICE_LIST.find((v) => v.id === 'bm_george')!;
		expect(getVoiceLabel(george)).toBe('George (Male, British English)');
	});
});
