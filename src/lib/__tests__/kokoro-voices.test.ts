import { describe, it, expect } from 'vitest';
import { getVoiceList, getVoiceLabel } from '$lib/kokoro/voices';

describe('getVoiceLabel', () => {
	it('formats American female voice', () => {
		const heart = getVoiceList().af_heart;
		expect(getVoiceLabel(heart)).toBe('Heart (Female, American English)');
	});

	it('formats British male voice', () => {
		const george = getVoiceList().bm_george;
		expect(getVoiceLabel(george)).toBe('George (Male, British English)');
	});
});
