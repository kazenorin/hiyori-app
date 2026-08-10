import en from './locales/en.json';
import zhHantHK from './locales/zh-Hant-HK.json';
import { SvelteSet } from 'svelte/reactivity';

// Lazy import to break circular init: i18n -> logger -> settings -> i18n
// (settings runs loadSettings() at module load, which needs detectDefaultLocale).
async function logger() {
	return (await import('$lib/logging/logger')).log;
}

export type Locale = string;

type TranslationValue = string | { [key: string]: TranslationValue };
type Translations = Record<string, TranslationValue>;

export function detectDefaultLocale(): Locale {
	const lang = typeof navigator !== 'undefined' ? (navigator.language?.toLowerCase() ?? '') : '';
	// zh-Hans (Simplified) gets its own branch when those strings are shipped:
	// if (lang.startsWith('zh-hans')) return 'zh-Hans';
	if (lang.startsWith('zh')) return 'zh-Hant-HK';
	return 'en';
}

let currentLocale = $state<Locale>('en');
let translations = $state<Translations>({});

const loadedLocales = new SvelteSet<Locale>();

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(obj)) {
		const fullKey = prefix ? `${prefix}.${key}` : key;
		if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
			Object.assign(result, flatten(value as Record<string, unknown>, fullKey));
		} else if (typeof value === 'string') {
			result[fullKey] = value;
		}
	}
	return result;
}

// eslint-disable-next-line prefer-const -- $derived requires let
let flatTranslations = $derived<Record<string, string>>(flatten(translations));

const localeLoaders: Record<Locale, () => Promise<Translations>> = {
	en: async () => en as unknown as Translations,
	'zh-Hant-HK': async () => zhHantHK as unknown as Translations,
};

export async function loadLocale(locale: Locale): Promise<void> {
	if (loadedLocales.has(locale) && locale === currentLocale) return;

	const loader = localeLoaders[locale];
	if (!loader) {
		void logger().then((log) => log.warn('i18n', `No loader registered for locale: ${locale}`));
		return;
	}

	try {
		translations = await loader();
		currentLocale = locale;
		loadedLocales.add(locale);
	} catch (err) {
		void logger().then((log) => log.error('i18n', `Failed to load locale ${locale}`, err));
	}
}

export async function setLocale(locale: Locale): Promise<void> {
	await loadLocale(locale);
}

export function getLocale(): Locale {
	return currentLocale;
}

export function t(key: string, params?: Record<string, string | number>): string {
	let value = flatTranslations[key];
	if (value === undefined) {
		void logger().then((log) => log.warn('i18n', `Missing translation key: ${key}`));
		return key;
	}
	if (params) {
		for (const [paramKey, paramValue] of Object.entries(params)) {
			value = value.replaceAll(`{{${paramKey}}}`, String(paramValue));
		}
	}
	return value;
}
