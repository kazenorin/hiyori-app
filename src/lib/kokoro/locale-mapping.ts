import { VOICES } from './kokoro-hiyori/voices';
import type { VoiceId, VoiceInfo } from './kokoro-hiyori/voices';

/**
 * Prefix-based matching: `en` matches `en`, `en-US`, `en-GB`; `zh` matches `zh`, `zh-Hant-HK`, `zh-Hans`.
 */
export function localeMatches(value: string, prefix: string): boolean {
	const v = value.toLowerCase();
	const p = prefix.toLowerCase();
	return v === p || v.startsWith(`${p}-`);
}

/**
 * Many-to-many story-locale → allowed voice-language mapping.
 * Keys and values are language prefixes: `en` matches `en-us`/`en-gb`, `zh` matches `zh`.
 * Prefix matching means `zh-Hant-HK` resolves via the `zh` entry.
 */
const LOCALE_TO_VOICE_LANGUAGES: Record<string, string[]> = {
	en: ['en'],
	zh: ['zh', 'yue'],
	yue: ['zh', 'yue'],
};

export function getAllowedVoiceLanguages(storyLocale: string): string[] {
	for (const [localePrefix, languages] of Object.entries(LOCALE_TO_VOICE_LANGUAGES)) {
		if (localeMatches(storyLocale, localePrefix)) {
			return languages;
		}
	}
	return [];
}

export function isTTSSupportedLocale(locale: string | undefined | null): boolean {
	return locale === undefined || locale === null ? false : getAllowedVoiceLanguages(locale).length > 0;
}

export function getVoicesForLocale(storyLocale: string): [VoiceId, VoiceInfo][] {
	const allowed = getAllowedVoiceLanguages(storyLocale);
	return (Object.entries(VOICES) as [VoiceId, VoiceInfo][]).filter(([, voice]) =>
		allowed.some((language) => localeMatches(voice.language, language))
	);
}
