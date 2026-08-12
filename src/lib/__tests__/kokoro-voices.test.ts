import { describe, it, expect, beforeAll } from 'vitest';
import { getVoiceList, getVoiceLabel } from '$lib/kokoro/voices';
import { loadLocale } from '$lib/i18n';

describe('getVoiceLabel', () => {
	beforeAll(async () => {
		await loadLocale('en');
	});

	it('formats American female voice', () => {
		const heart = getVoiceList().af_heart;
		expect(getVoiceLabel(heart)).toBe('Heart (Female, American English)');
	});

	it('formats British male voice', () => {
		const george = getVoiceList().bm_george;
		expect(getVoiceLabel(george)).toBe('George (Male, British English)');
	});
});
